import { test } from "node:test";
import assert from "node:assert/strict";

import { ManifestError, parseManifest } from "../lib/skill-manifest.mjs";

/** node:assert's throws() returns undefined, so capture the error to assert on its fields. */
function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("expected the call to throw");
}

const VALID = {
  skill: "theokit-memory",
  teaches: ["@theokit/sdk/memory"],
  concept: "Memory that persists across agent runs",
  triggers: ["memory", "remember across sessions"],
  regions: [{ id: "create-agent-with-memory", explains: "Enabling memory when creating the agent" }],
  notCovered: ["external adapters: mem0, honcho, supermemory"],
  credentials: ["ANTHROPIC_API_KEY"],
};

test("accepts a complete manifest and defaults evidence to an empty list", () => {
  const manifest = parseManifest(VALID, "capabilities/memory/skill.json");

  assert.equal(manifest.skill, "theokit-memory");
  assert.deepEqual(manifest.evidence, []);
});

test("preserves region order, because array order is teaching order", () => {
  const manifest = parseManifest(
    { ...VALID, regions: [{ id: "second", explains: "b" }, { id: "first", explains: "a" }] },
    "p",
  );

  assert.deepEqual(manifest.regions.map((region) => region.id), ["second", "first"]);
});

test("rejects a skill name without the theokit- prefix, naming the field", () => {
  const error = captureError(() => parseManifest({ ...VALID, skill: "memory" }, "p"));
  assert.ok(error instanceof ManifestError);
  assert.equal(error.field, "skill");
});

test("rejects an empty notCovered, because the honest gap is the point", () => {
  const error = captureError(() => parseManifest({ ...VALID, notCovered: [] }, "p"));
  assert.ok(error instanceof ManifestError);
  assert.equal(error.field, "notCovered");
});

test("rejects a teaches entry that is not an export subpath of a @theokit package", () => {
  const error = captureError(() => parseManifest({ ...VALID, teaches: ["lodash"] }, "p"));
  assert.ok(error instanceof ManifestError);
  assert.equal(error.field, "teaches");
});

test("rejects a region id that is not kebab-case, because no marker could ever match it", () => {
  const error = captureError(() => parseManifest({ ...VALID, regions: [{ id: "Create_Agent", explains: "x" }] }, "p"));
  assert.ok(error instanceof ManifestError);
  assert.equal(error.field, "regions");
});

test("rejects an evidence entry missing its claim", () => {
  const error = captureError(() => parseManifest({ ...VALID, evidence: [{ command: "npm start" }] }, "p"));
  assert.ok(error instanceof ManifestError);
  assert.equal(error.field, "evidence");
});
