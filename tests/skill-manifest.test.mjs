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
  skill: "theokit-sdk-memory",
  teaches: ["@theokit/sdk/memory"],
  concept: "Memory that persists across agent runs",
  triggers: ["memory", "remember across sessions"],
  lessons: [{ id: "create-agent-with-memory", explains: "Enabling memory when creating the agent" }],
  notCovered: ["external adapters: mem0, honcho, supermemory"],
  credentials: ["ANTHROPIC_API_KEY"],
};

test("accepts a complete manifest and defaults evidence to an empty list", () => {
  const manifest = parseManifest(VALID, "sdk/memory/skill.json");

  assert.equal(manifest.skill, "theokit-sdk-memory");
  assert.deepEqual(manifest.evidence, []);
});

test("preserves lesson order, because array order is teaching order", () => {
  const manifest = parseManifest(
    { ...VALID, lessons: [{ id: "second", explains: "b" }, { id: "first", explains: "a" }] },
    "p",
  );

  assert.deepEqual(manifest.lessons.map((lesson) => lesson.id), ["second", "first"]);
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

test("rejects a lesson id that is not kebab-case, because no marker could ever match it", () => {
  const error = captureError(() => parseManifest({ ...VALID, lessons: [{ id: "Create_Agent", explains: "x" }] }, "p"));
  assert.ok(error instanceof ManifestError);
  assert.equal(error.field, "lessons");
});

test("rejects an evidence entry missing its claim", () => {
  const error = captureError(() => parseManifest({ ...VALID, evidence: [{ command: "npm start" }] }, "p"));
  assert.ok(error instanceof ManifestError);
  assert.equal(error.field, "evidence");
});

test("rejects an evidence value that is not an array", () => {
  const error = captureError(() => parseManifest({ ...VALID, evidence: { command: "a", claims: "b" } }, "p"));
  assert.ok(error instanceof ManifestError);
  assert.equal(error.field, "evidence");
});

test("accepts a bare package root in teaches, which the memory example relies on", () => {
  const manifest = parseManifest({ ...VALID, teaches: ["@theokit/sdk"] }, "p");
  assert.deepEqual(manifest.teaches, ["@theokit/sdk"]);
});

test("defaults the neighbourhood fields to empty lists, so an example may declare neither", () => {
  const manifest = parseManifest(VALID, "p");

  assert.deepEqual(manifest.seeAlso, []);
  assert.deepEqual(manifest.requires, []);
});

test("carries seeAlso and requires through, because a skill an agent cannot reach is one it reinvents", () => {
  const manifest = parseManifest(
    { ...VALID, seeAlso: ["theokit-sessions"], requires: ["theokit-agents"] },
    "p",
  );

  assert.deepEqual(manifest.seeAlso, ["theokit-sessions"]);
  assert.deepEqual(manifest.requires, ["theokit-agents"]);
});

test("rejects a seeAlso entry that is not a skill name", () => {
  const error = captureError(() => parseManifest({ ...VALID, seeAlso: ["sessions"] }, "p"));
  assert.ok(error instanceof ManifestError);
  assert.equal(error.field, "seeAlso");
});

test("rejects a requires entry that is not a skill name", () => {
  const error = captureError(() => parseManifest({ ...VALID, requires: ["@theokit/sdk"] }, "p"));
  assert.ok(error instanceof ManifestError);
  assert.equal(error.field, "requires");
});

test("rejects a skill that lists itself as its own neighbour", () => {
  const error = captureError(() => parseManifest({ ...VALID, seeAlso: ["theokit-sdk-memory"] }, "p"));
  assert.ok(error instanceof ManifestError);
  assert.equal(error.field, "seeAlso");
});

test("accepts the framework package, which carries no scope", () => {
  const manifest = parseManifest({ ...VALID, teaches: ["theokit", "@theokit/agents"] }, "p");
  assert.deepEqual(manifest.teaches, ["theokit", "@theokit/agents"]);
});

test("accepts a framework subpath", () => {
  const manifest = parseManifest({ ...VALID, teaches: ["theokit/server/define"] }, "p");
  assert.deepEqual(manifest.teaches, ["theokit/server/define"]);
});

test("still rejects a package outside the ecosystem", () => {
  const error = captureError(() => parseManifest({ ...VALID, teaches: ["react"] }, "p"));
  assert.ok(error instanceof ManifestError);
  assert.equal(error.field, "teaches");
});
