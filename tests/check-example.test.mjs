import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
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
