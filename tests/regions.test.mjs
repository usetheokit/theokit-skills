import { test } from "node:test";
import assert from "node:assert/strict";

import { parseRegions, RegionError } from "../lib/regions.mjs";

/** node:assert's throws() returns undefined, so capture the error to assert on its fields. */
function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("expected the call to throw");
}

test("parses one region and excludes its markers", () => {
  const source = [
    "const before = 1;",
    "// #region skill:create-agent",
    "const agent = 2;",
    "// #endregion",
    "const after = 3;",
  ].join("\n");

  const regions = parseRegions(source, "src/a.ts");

  assert.equal(regions.length, 1);
  assert.equal(regions[0].id, "create-agent");
  assert.equal(regions[0].file, "src/a.ts");
  assert.equal(regions[0].startLine, 2);
  assert.equal(regions[0].endLine, 4);
  assert.equal(regions[0].code, "const agent = 2;");
});

test("keeps comments inside a region, because that is where the hard-won prose lives", () => {
  const source = [
    "// #region skill:ask",
    "// TWO CALLS, not one. send() hands back a handle.",
    "const run = await agent.send(message);",
    "// #endregion",
  ].join("\n");

  const [region] = parseRegions(source, "src/a.ts");

  assert.match(region.code, /TWO CALLS, not one/);
});

test("a region that is never closed names the file and the opening line", () => {
  const source = ["// #region skill:orphan", "const a = 1;"].join("\n");

  const error = captureError(() => parseRegions(source, "src/a.ts"));
  assert.ok(error instanceof RegionError);
  assert.equal(error.file, "src/a.ts");
  assert.equal(error.line, 1);
  assert.match(error.message, /orphan/);
});

test("a nested region is rejected, naming both ids", () => {
  const source = [
    "// #region skill:outer",
    "// #region skill:inner",
    "// #endregion",
    "// #endregion",
  ].join("\n");

  const error = captureError(() => parseRegions(source, "src/a.ts"));
  assert.ok(error instanceof RegionError);
  assert.match(error.message, /inner/);
  assert.match(error.message, /outer/);
});

test("an #endregion with no open region is rejected", () => {
  const error = captureError(() => parseRegions("// #endregion", "src/a.ts"));
  assert.ok(error instanceof RegionError);
  assert.equal(error.line, 1);
});

test("a non-kebab-case id is not recognised as a region marker", () => {
  assert.deepEqual(parseRegions("// #region skill:Create_Agent", "src/a.ts"), []);
});
