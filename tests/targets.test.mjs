/**
 * The write-target registry.
 *
 * The claim these pin is the one that shrinks the whole problem: two directories serve six tools,
 * so the installer writes locations rather than maintaining a per-tool adapter list.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { TARGETS, detectTargets, targetById } from "../lib/targets.mjs";

const roots = [];
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "theokit-targets-"));
  roots.push(dir);
  return dir;
}
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

test(".agents/skills is the widest target and serves the five tools that read it", () => {
  const agents = targetById("agents");
  for (const tool of ["OpenAI Codex", "Gemini CLI", "GitHub Copilot", "Zed", "Devin Desktop"]) {
    assert.ok(agents.serves.includes(tool), `${tool} reads .agents/skills`);
  }
});

test("Claude Code is the holdout that needs its own directory", () => {
  const claude = targetById("claude");
  assert.ok(claude.serves.includes("Claude Code"));
  assert.ok(!targetById("agents").serves.includes("Claude Code"), "Claude Code does not read .agents/");
});

test("the github target has no personal scope — those surfaces read the repository only", () => {
  assert.equal(targetById("github").globalDir(), undefined);
  for (const id of ["agents", "claude"]) {
    assert.ok(targetById(id).globalDir() !== undefined, `${id} has a personal scope`);
  }
});

test("a project is detected by the tool directory it already has", () => {
  const root = scratch();
  mkdirSync(join(root, ".claude"), { recursive: true });
  const ids = detectTargets(root).map((t) => t.id);
  assert.ok(ids.includes("claude"));
});

test("CLAUDE_CONFIG_DIR is honoured — installing into ~/.claude when the user moved it writes a dead directory", async () => {
  const root = scratch();
  const previous = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = root;
  try {
    // Re-import with a cache-busting query so the module re-reads the environment.
    const fresh = await import(`../lib/targets.mjs?claude-home=${encodeURIComponent(root)}`);
    assert.equal(fresh.targetById("claude").globalDir(), join(root, "skills"));
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
  }
});

test("every target declares which tools it serves — an undocumented target is an unexplained directory", () => {
  for (const target of TARGETS) {
    assert.ok(target.serves.length > 0, `${target.id} must say what it is for`);
    assert.ok(target.label.includes("skills"), `${target.id} must land under a skills dir`);
  }
});
