/**
 * The install manifest and the drift states it distinguishes.
 *
 * Drift is reported as three distinct kinds because the fixes differ, and a boolean would send a
 * user who never installed and a user whose install went stale to the same unhelpful message.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { digestOf, drift, readManifest, writeManifest, manifestPath } from "../lib/manifest.mjs";

/** Stamp each entry with the digest of what is on disk right now — what the installer does. */
function withDigests(root, entries) {
  return entries.map((e) => ({ ...e, digest: digestOf(join(root, e.path)) }));
}

const roots = [];
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "theokit-manifest-"));
  roots.push(dir);
  return dir;
}
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

function installedSkill(root, rel) {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "# s\n");
  return { path: dir };
}

test("no manifest reports `absent`, not `current` — never installed is not up to date", () => {
  assert.equal(drift(scratch(), { version: "1.0.0", expected: [] }).kind, "absent");
});

test("a manifest from another version reports `version`, with both numbers", () => {
  const root = scratch();
  writeManifest(root, { version: "0.3.0", entries: [] });
  const state = drift(root, { version: "1.0.0", expected: [] });
  assert.equal(state.kind, "version");
  assert.equal(state.installed, "0.3.0");
  assert.equal(state.current, "1.0.0");
});

test("a matching version with the files deleted reports `missing`, and names them", () => {
  // Rewritten for B-002: `expected` was a parameter, and the caller passed the INSTALLATION PLAN —
  // what an install would do on THIS machine. That made the gate's answer depend on which other
  // tools happened to be installed on the runner. The manifest is the only record of what was
  // actually installed, so it is now the only expectation.
  const root = scratch();
  writeManifest(root, {
    version: "1.0.0",
    entries: [{ skill: "gone", target: "agents", path: "gone", mode: "copy", digest: "irrelevant" }],
  });

  const state = drift(root, { version: "1.0.0" });

  assert.equal(state.kind, "missing");
  assert.deepEqual(state.missing, ["gone"]);
});

test("a matching version with the files present reports `current`", () => {
  const root = scratch();
  writeManifest(root, { version: "1.0.0", entries: [] });
  const there = installedSkill(root, join(".agents", "skills", "s"));
  assert.equal(drift(root, { version: "1.0.0", expected: [there] }).kind, "current");
});

test("entries are sorted so the committed file is stable across runs", () => {
  const root = scratch();
  const body = writeManifest(root, {
    version: "1.0.0",
    entries: [
      { skill: "b", target: "claude", path: "x", mode: "copy" },
      { skill: "a", target: "agents", path: "y", mode: "copy" },
    ],
  });
  assert.deepEqual(body.entries.map((e) => e.skill), ["a", "b"]);
});

test("a corrupt manifest is treated as absent rather than crashing the installer", () => {
  const root = scratch();
  writeFileSync(manifestPath(root), "{ not json");
  assert.equal(readManifest(root), undefined);
  assert.equal(drift(root, { version: "1.0.0", expected: [] }).kind, "absent");
});

// ── B-002: `--check` detected exactly one thing, and it was not drift ─────────────────────────────
//
// Measured on 55d64ca with a control in both directions: an intact install exits 0, a deleted skill
// directory exits 1 — and a CHANGED `SKILL.md` also exits 0. The gate the help text calls "fail if
// what is installed drifted from this version (CI)" could not see an edited instruction file.
//
// It compares content now, over the whole skill DIRECTORY, which is what makes a file under
// `references/` covered without a second mechanism.

test("a changed file in an installed skill is drift, not health", () => {
  const root = scratch();
  const skill = join(root, "skills", "theokit-x");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "the original instruction");

  const entries = [{ skill: "theokit-x", target: "agents", path: "skills/theokit-x", mode: "copy" }];
  writeManifest(root, { version: "1.0.0", entries: withDigests(root, entries) });

  assert.equal(drift(root, { version: "1.0.0" }).kind, "current", "control: untouched must be clean");

  writeFileSync(join(skill, "SKILL.md"), "the original instruction, quietly edited");
  const state = drift(root, { version: "1.0.0" });

  assert.equal(state.kind, "content");
  assert.deepEqual(state.changed, ["skills/theokit-x"]);
});

test("a file under references/ is covered by the same comparison", () => {
  const root = scratch();
  const skill = join(root, "skills", "theokit-x");
  mkdirSync(join(skill, "references"), { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "instruction");
  writeFileSync(join(skill, "references", "api.md"), "the generated surface");

  const entries = [{ skill: "theokit-x", target: "agents", path: "skills/theokit-x", mode: "copy" }];
  writeManifest(root, { version: "1.0.0", entries: withDigests(root, entries) });
  assert.equal(drift(root, { version: "1.0.0" }).kind, "current");

  rmSync(join(skill, "references", "api.md"));

  assert.equal(drift(root, { version: "1.0.0" }).kind, "content", "B-002 DoD bullet 3");
});

test("a manifest without digests is refused, not half-checked", () => {
  const root = scratch();
  // a schema-1 manifest, written by hand as an older version would have
  writeFileSync(
    manifestPath(root),
    JSON.stringify({ schema: 1, package: "@theokit/skills", version: "1.0.0", entries: [] }),
  );

  assert.equal(
    drift(root, { version: "1.0.0" }).kind,
    "absent",
    "wipe and reinstall — never silently migrate, per the schema's own contract",
  );
});

test("a dangling link is missing, and never a crash", () => {
  // `npm ci` removing the package leaves a link whose target is gone. Measured: existsSync says
  // false, lstat says symlink, and hashing it throws ENOENT — so existence must be checked first.
  const root = scratch();
  mkdirSync(join(root, "skills"), { recursive: true });
  symlinkSync(join(root, "gone"), join(root, "skills", "theokit-x"));

  const entries = [{ skill: "theokit-x", target: "agents", path: "skills/theokit-x", mode: "link", digest: "deadbeef" }];
  writeManifest(root, { version: "1.0.0", entries });

  const state = drift(root, { version: "1.0.0" });

  assert.equal(state.kind, "missing");
  assert.deepEqual(state.missing, ["skills/theokit-x"]);
});

// ── Properties of the digest that nothing asserted ────────────────────────────────────────────────
//
// Found by mutation testing, not by inspection: dropping the `.sort()` at manifest.mjs:98, or the
// `hash.update(rel)` at :111, or the `/` separator at :102, all survived the suite. Each is a real
// property of a value that gets COMMITTED in a manifest and compared on another machine — an
// unstable digest is a gate that fails for the wrong reason.
//
// These are characterization tests: the code already has the properties, and nothing held it to
// them. Each was verified to go red against its own mutation before being kept.

// NOT TESTED, and the reason is worth more than a green test: the digest's stability across
// filesystems. `manifest.mjs:98` sorts entries because `readdirSync` order is filesystem-dependent,
// and a digest that varies by machine is a gate that fails for the wrong reason — the value is
// COMMITTED in a manifest and compared elsewhere. Measured on this machine: `readdirSync` already
// returns lexicographic order, so removing the `.sort()` changes nothing observable here. A test
// was written for it and DELETED after mutation testing showed it killed nothing: it asserted a
// property it could not exercise, which is the tautology class this repository keeps paying for.
// Exercising it needs a filesystem that returns unsorted entries (APFS, some Windows volumes) or a
// mocked `node:fs`. Registered rather than faked.

test("renaming a file changes the digest, even when its content does not", () => {
  const root = scratch();
  const dir = join(root, "skill");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), "identical bytes");
  const before = digestOf(dir);

  rmSync(join(dir, "SKILL.md"));
  writeFileSync(join(dir, "RENAMED.md"), "identical bytes");

  assert.notEqual(digestOf(dir), before, "the file's name is part of what was installed");
});

test("a nested path cannot collide with a flat one that concatenates to the same string", () => {
  // The separator at manifest.mjs:102 is what keeps `references/api.md` distinct from a top-level
  // file literally named `referencesapi.md`. Without it both hash the same string, and moving a
  // file into `references/` would be invisible. The first version of this test compared
  // `references/api.md` against a top-level `api.md` — which differ either way, so it passed
  // against the mutation and proved nothing.
  const flat = scratch();
  mkdirSync(join(flat, "skill"), { recursive: true });
  writeFileSync(join(flat, "skill", "referencesapi.md"), "the generated surface");

  const nested = scratch();
  mkdirSync(join(nested, "skill", "references"), { recursive: true });
  writeFileSync(join(nested, "skill", "references", "api.md"), "the generated surface");

  assert.notEqual(digestOf(join(flat, "skill")), digestOf(join(nested, "skill")));
});

test("installing a second target does not drop the first from the manifest", () => {
  // W-01, /review BLOCKER, reproduced before writing this: install for `agents`, then for `claude`,
  // and the manifest held 31 `claude` entries. The `.agents/skills` install stayed on disk and left
  // the gate's scope entirely — tampering with it produced `up to date — 31` and exit 0. The count
  // was true of the manifest and false of the tree, which is the one thing a gate may never do.
  //
  // Created by making the manifest the sole expectation: before that, `--check` derived its
  // expectation from detected targets and would at least have looked.
  const root = scratch();
  const agents = [{ skill: "theokit-x", target: "agents", path: "a/theokit-x", mode: "copy", digest: "d1" }];
  const claude = [{ skill: "theokit-x", target: "claude", path: "c/theokit-x", mode: "copy", digest: "d2" }];

  writeManifest(root, { version: "1.0.0", entries: agents });
  writeManifest(root, { version: "1.0.0", entries: claude });

  const merged = readManifest(root).entries;
  assert.equal(merged.length, 2, "a second target must add, not replace");
  assert.deepEqual(
    merged.map((e) => e.target).sort(),
    ["agents", "claude"],
  );
});

test("re-installing the same target replaces its own entries, and only those", () => {
  const root = scratch();
  writeManifest(root, {
    version: "1.0.0",
    entries: [
      { skill: "theokit-x", target: "agents", path: "a/theokit-x", mode: "copy", digest: "old" },
      { skill: "theokit-y", target: "claude", path: "c/theokit-y", mode: "copy", digest: "keep" },
    ],
  });

  writeManifest(root, {
    version: "1.0.0",
    entries: [{ skill: "theokit-x", target: "agents", path: "a/theokit-x", mode: "copy", digest: "new" }],
  });

  const entries = readManifest(root).entries;
  assert.equal(entries.length, 2);
  assert.equal(entries.find((e) => e.target === "agents").digest, "new");
  assert.equal(entries.find((e) => e.target === "claude").digest, "keep", "another target is not collateral");
});

test("a version change replaces the manifest wholesale", () => {
  // Merging across versions would keep entries describing a layout the new version may not produce.
  // The schema's own contract is wipe-and-reinstall, and this is the same reasoning one field over.
  const root = scratch();
  writeManifest(root, {
    version: "1.0.0",
    entries: [{ skill: "theokit-x", target: "claude", path: "c/theokit-x", mode: "copy", digest: "old" }],
  });

  writeManifest(root, {
    version: "2.0.0",
    entries: [{ skill: "theokit-x", target: "agents", path: "a/theokit-x", mode: "copy", digest: "new" }],
  });

  const entries = readManifest(root).entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].target, "agents");
});

test("a manifest path written on Windows resolves on POSIX", () => {
  // W-05: `relative()` returns backslashes on Windows, and POSIX `join` treats them as part of a
  // filename — so a manifest committed from a Windows checkout reports EVERY entry `missing` on a
  // Linux runner. The module header says the file "is meant to be committed alongside the skills it
  // describes", so cross-OS reading is the intended use, not an edge.
  //
  // This became reachable when `drift()` started resolving `entry.path`; before, the field was
  // written and never read.
  const root = scratch();
  const skill = join(root, "a", "theokit-x");
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, "SKILL.md"), "instruction");

  writeManifest(root, {
    version: "1.0.0",
    entries: [
      // exactly what a Windows install writes
      { skill: "theokit-x", target: "agents", path: "a\\theokit-x", mode: "copy", digest: digestOf(skill) },
    ],
  });

  assert.equal(drift(root, { version: "1.0.0" }).kind, "current");
});

test("digestOf failing during install does not leave the tree without a manifest", () => {
  // W-04: `digestOf` was called INSIDE the `writeManifest` argument, so a throw — a dangling child
  // symlink, an unreadable file, a symlink cycle — happened after every skill was placed and before
  // any manifest was written. Skills on disk, no manifest, and the next `--check` says "the skills
  // were never installed here".
  const root = scratch();
  const skill = join(root, "a", "theokit-x");
  mkdirSync(skill, { recursive: true });
  symlinkSync(join(root, "gone"), join(skill, "dangling.md"));

  assert.doesNotThrow(() => digestOf(skill), "an unreadable child must not abort the install");
});
