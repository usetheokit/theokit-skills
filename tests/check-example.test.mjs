import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { makeExample } from "./_fixture.mjs";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "check-example.mjs");

function run(root) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, root], { encoding: "utf8" }) };
  } catch (error) {
    return { code: error.status, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

test("exits 0 and names the example it checked", () => {
  const root = resolve(makeExample(), "..", "..");
  const { code, out } = run(root);

  assert.equal(code, 0);
  assert.match(out, /capabilities\/memory/);
});

test("exits 1 and names the rule when an example is malformed", () => {
  const root = resolve(makeExample((files) => { files["README.md"] = null; }), "..", "..");
  const { code, out } = run(root);

  assert.equal(code, 1);
  assert.match(out, /required-files/);
  assert.match(out, /README\.md/);
});

test("exits 1 when the tree contains no example, rather than reporting success over nothing", () => {
  const { code, out } = run(mkdtempSync(join(tmpdir(), "theokit-empty-")));

  assert.equal(code, 1);
  assert.match(out, /no example/i);
});

test("an example nested inside another example is still discovered", () => {
  const outer = makeExample();
  const root = resolve(outer, "..", "..");
  const inner = join(outer, "nested", "capabilities", "memory");
  mkdirSync(inner, { recursive: true });
  writeFileSync(join(inner, "skill.json"), "{}");

  const { out } = run(root);

  assert.match(out, /nested\/capabilities\/memory/);
});

test("a root path that does not exist is named, not dumped as a stack trace", () => {
  const { code, out } = run(join(tmpdir(), "theokit-absent-root-xyz"));

  assert.equal(code, 1);
  assert.match(out, /does not exist/);
  assert.doesNotMatch(out, /at readdirSync/);
});

test("an example whose check throws is named, and the run continues", () => {
  const first = makeExample();
  const root = resolve(first, "..", "..");
  // A .gitignore that is a directory makes readFileSync raise EISDIR, which checkExample re-throws.
  rmSync(join(first, ".gitignore"));
  mkdirSync(join(first, ".gitignore"));

  const { code, out } = run(root);

  assert.equal(code, 1);
  assert.match(out, /ERROR capabilities\/memory/);
  assert.doesNotMatch(out, /at checkExample/);
});

test("an example passed directly as the root is named rather than printed blank", () => {
  const { out } = run(makeExample());

  assert.match(out, /^(ok|FAIL)\s+memory/m);
});
