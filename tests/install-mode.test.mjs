/**
 * The cross-platform placement rules.
 *
 * These are the tests that answer "does this work on Windows?" — and they answer it by RUNNING on
 * Windows in CI, not by asserting a platform string. `place()` is exercised for real: the link is
 * created, or it is refused and the fallback copies, and both outcomes are asserted.
 *
 * Run: `npm test` (node --test, zero dependencies).
 */
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { after, test } from "node:test";

import { isStableSource, linkSpec, place, currentMode } from "../lib/install-mode.mjs";

const roots = [];
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "theokit-skills-"));
  roots.push(dir);
  return dir;
}
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/** A skill directory, as the package ships one. */
function skillAt(root, name, body = "# skill\n") {
  const dir = join(root, "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), body);
  return dir;
}

test("a package inside the project's node_modules is a stable link source", () => {
  const project = join(sep, "home", "u", "app");
  assert.equal(isStableSource(join(project, "node_modules", "@theokit", "skills"), project), true);
});

test("the npx cache is NOT a stable link source — a link into it dangles once npx prunes", () => {
  const project = join(sep, "home", "u", "app");
  assert.equal(isStableSource(join(sep, "home", "u", ".npm", "_npx", "a1", "node_modules", "x"), project), false);
});

test("a sibling directory that merely starts with the same characters is not inside node_modules", () => {
  const project = join(sep, "home", "u", "app");
  // `node_modules_backup` shares a prefix with `node_modules`; the separator is what separates them.
  assert.equal(isStableSource(join(project, "node_modules_backup", "pkg"), project), false);
});

test("Windows links are junctions with an absolute target — they need no elevated privilege", () => {
  const spec = linkSpec(join(sep, "a", "b", "skills", "x"), join(sep, "a", "b", ".claude", "skills", "x"), "win32");
  assert.equal(spec.type, "junction");
  assert.ok(spec.target.endsWith(join("skills", "x")), "junction target must be absolute");
  assert.ok(!spec.target.startsWith(".."), "junction target must not be relative");
});

test("elsewhere the link is relative, so moving the tree does not break it", () => {
  const spec = linkSpec(join(sep, "a", "b", "skills", "x"), join(sep, "a", "b", ".claude", "skills", "x"), "linux");
  assert.equal(spec.type, undefined);
  assert.ok(spec.target.startsWith(".."), `expected a relative target, got ${spec.target}`);
});

test("place() links when asked, and the agent reads the source through it", () => {
  const root = scratch();
  const source = skillAt(root, "theokit-sdk", "# linked\n");
  const dest = join(root, ".claude", "skills", "theokit-sdk");

  const result = place(source, dest, { preferLink: true });

  assert.equal(result.changed, true);
  assert.ok(existsSync(join(dest, "SKILL.md")), "the skill has to be readable at the destination");
  assert.equal(readFileSync(join(dest, "SKILL.md"), "utf8"), "# linked\n");

  // Either a link was made, or the filesystem refused and it fell back — both are correct, and the
  // result says which. What is NOT allowed is claiming a link while having copied.
  if (result.mode === "link") {
    assert.equal(lstatSync(dest).isSymbolicLink(), true);
    assert.equal(result.linkFailed, false);
  } else {
    assert.equal(result.linkFailed, true, "a copy under preferLink must report the link failure");
    assert.equal(lstatSync(dest).isSymbolicLink(), false);
  }
});

test("a link makes the destination follow edits to the source — this is the point of linking", (t) => {
  const root = scratch();
  const source = skillAt(root, "s", "# v1\n");
  const dest = join(root, ".claude", "skills", "s");
  const result = place(source, dest, { preferLink: true });
  if (result.mode !== "link") return t.skip("filesystem refused links; the copy path is covered above");

  writeFileSync(join(source, "SKILL.md"), "# v2\n");
  assert.equal(readFileSync(join(dest, "SKILL.md"), "utf8"), "# v2\n");
});

test("place() copies when asked, and the copy does NOT follow the source", () => {
  const root = scratch();
  const source = skillAt(root, "s", "# v1\n");
  const dest = join(root, ".agents", "skills", "s");

  const result = place(source, dest, { preferLink: false });
  assert.equal(result.mode, "copy");
  assert.equal(result.linkFailed, false);

  writeFileSync(join(source, "SKILL.md"), "# v2\n");
  assert.equal(readFileSync(join(dest, "SKILL.md"), "utf8"), "# v1\n", "a copy is a snapshot");
});

test("re-running changes nothing and does not destroy what is there", () => {
  const root = scratch();
  const source = skillAt(root, "s");
  const dest = join(root, ".agents", "skills", "s");

  const first = place(source, dest, { preferLink: false });
  const second = place(source, dest, { preferLink: false });

  assert.equal(first.changed, true);
  assert.equal(second.changed, false, "a second run is a no-op");
  assert.ok(existsSync(join(dest, "SKILL.md")));
});

test("--force replaces, and re-reports the mode it produced", () => {
  const root = scratch();
  const source = skillAt(root, "s", "# fresh\n");
  const dest = join(root, ".agents", "skills", "s");
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "SKILL.md"), "# stale\n");

  const result = place(source, dest, { preferLink: false, force: true });
  assert.equal(result.changed, true);
  assert.equal(readFileSync(join(dest, "SKILL.md"), "utf8"), "# fresh\n");
});

test("a dangling link at the destination is replaced, not mistaken for absence", (t) => {
  const root = scratch();
  const source = skillAt(root, "s");
  const dest = join(root, ".agents", "skills", "s");

  // Build a link to something that does not exist — exactly what an npx-cache link becomes.
  const gone = join(root, "gone");
  mkdirSync(join(root, ".agents", "skills"), { recursive: true });
  mkdirSync(gone, { recursive: true });
  const seeded = place(gone, dest, { preferLink: true });
  if (seeded.mode !== "link") return t.skip("filesystem refused links");
  rmSync(gone, { recursive: true, force: true });

  assert.equal(existsSync(dest), false, "existsSync follows the link and reports absence");
  const result = place(source, dest, { preferLink: false, force: true });
  assert.equal(result.changed, true);
  assert.equal(readFileSync(join(dest, "SKILL.md"), "utf8"), "# skill\n");
});

test("currentMode reports how a path was installed", () => {
  const root = scratch();
  const source = skillAt(root, "s");
  const dest = join(root, ".agents", "skills", "s");
  place(source, dest, { preferLink: false });
  assert.equal(currentMode(dest), "copy");
});

/** Two distinct sources and a destination, each in a scratch root the suite cleans up. */
function twoSources() {
  const root = scratch();
  const a = join(root, "package-a", "theokit-x");
  const b = join(root, "package-b", "theokit-x");
  mkdirSync(a, { recursive: true });
  mkdirSync(b, { recursive: true });
  writeFileSync(join(a, "SKILL.md"), "from a");
  writeFileSync(join(b, "SKILL.md"), "from b");
  return { source: { a, b }, dest: join(root, "project", ".agents", "skills", "theokit-x") };
}

// ── B-011: `alreadyLinked` decided a real thing and nothing asserted it ───────────────────────────
//
// Seven mutants survive at lib/install-mode.mjs:58-61 — the `isSymbolicLink()` check and the
// `resolve(...) === resolve(target)` comparison. Nothing in the suite distinguished a link pointing
// at the CURRENT package from one pointing at an older checkout, and `place()` uses that answer to
// decide whether a re-run replaces the link.
//
// The contract asserted here is the one MEASURED, not the one the plan first assumed: without
// `--force` a link elsewhere is left alone, because that is what `--force` is for.

test("a link already pointing at the right target is left alone", () => {
  const { source, dest } = twoSources();
  assert.deepEqual(place(source.a, dest, { preferLink: true }), {
    mode: "link",
    changed: true,
    linkFailed: false,
  });

  assert.deepEqual(place(source.a, dest, { preferLink: true }), {
    mode: "link",
    changed: false,
    linkFailed: false,
  });
});

test("a link pointing somewhere else is left alone without --force", () => {
  const { source, dest } = twoSources();
  place(source.a, dest, { preferLink: true });

  const result = place(source.b, dest, { preferLink: true });

  assert.equal(result.changed, false, "--force is what replaces what is already there");
  assert.equal(
    resolve(dirname(dest), readlinkSync(dest)),
    resolve(source.a),
    "and it still points at the old target",
  );
});

test("a link pointing somewhere else IS replaced with --force", () => {
  const { source, dest } = twoSources();
  place(source.a, dest, { preferLink: true });

  const result = place(source.b, dest, { preferLink: true, force: true });

  assert.equal(result.changed, true);
  assert.equal(resolve(dirname(dest), readlinkSync(dest)), resolve(source.b));
});

test("a plain directory is not mistaken for a link", () => {
  const { source, dest } = twoSources();
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "already-here.md"), "x");

  const result = place(source.a, dest, { preferLink: true });

  assert.equal(result.mode, "copy", "an existing directory is reported as what it is");
  assert.equal(result.changed, false);
});

test("a stale link and a correct one are reported identically — pinned, not endorsed", () => {
  // F-2 (/review, LOW): `place()` returns a byte-identical `{mode:"link", changed:false}` whether the
  // existing link is correct or points at a different package, and the stale case keeps serving the
  // old content. The reviewer confirmed the reading is fair — `--help` says `--force  replace what is
  // already there`, so leaving it alone IS the contract — and then found that nothing pinned the
  // reporting half, so the ambiguity could be made worse without a test noticing.
  //
  // This asserts the CURRENT behaviour so a change to it is deliberate. It does not endorse it.
  const { source, dest } = twoSources();
  place(source.a, dest, { preferLink: true });

  const correct = place(source.a, dest, { preferLink: true });
  const stale = place(source.b, dest, { preferLink: true });

  assert.deepEqual(stale, correct, "identical today — if this ever differs, it was a decision");
  assert.equal(
    readFileSync(join(dest, "SKILL.md"), "utf8"),
    "from a",
    "and the stale case keeps serving the old content, which is what --check exists to catch",
  );
});
