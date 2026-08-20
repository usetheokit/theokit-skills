/**
 * The install manifest and the drift states it distinguishes.
 *
 * Drift is reported as three distinct kinds because the fixes differ, and a boolean would send a
 * user who never installed and a user whose install went stale to the same unhelpful message.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { drift, readManifest, writeManifest, manifestPath } from "../lib/manifest.mjs";

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
  const root = scratch();
  writeManifest(root, { version: "1.0.0", entries: [] });
  const state = drift(root, { version: "1.0.0", expected: [{ path: join(root, "gone") }] });
  assert.equal(state.kind, "missing");
  assert.equal(state.missing.length, 1);
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
