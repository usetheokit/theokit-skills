/**
 * The write-target registry.
 *
 * The claim these pin is the one that shrinks the whole problem: two directories serve six tools,
 * so the installer writes locations rather than maintaining a per-tool adapter list.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

// ── B-011: four detection sources, two of them never mentioned by any test ────────────────────────
//
// `lib/targets.mjs:50-53` is a four-way OR — `.agents` in the project, `~/.agents`, `~/.codex`,
// `~/.gemini` — and seven mutants survive there. A grep over the whole suite found no test naming
// `.codex` or `.gemini` at all.
//
// This is not a coverage statistic. `detect()` decides WHERE AN INSTALL WRITES, so a mutation that
// drops `~/.codex` means a Codex user silently receives no skills and the suite stays green.
//
// Spawned, not imported: `lib/targets.mjs` reads `os.homedir()` directly, so an in-process test
// would either monkeypatch `node:os` — testing the mock — or assert against the developer's real
// home, which is why these two sources have no test today. (ADR-1 of the plan.)

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "install.mjs");

/** Run a dry-run install with `home` standing in as the user's home directory. */
function detectWith({ home = [], project = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "detect-"));
  detectRoots.push(root);
  const fakeHome = join(root, "home");
  const cwd = join(root, "project");
  for (const dir of [fakeHome, cwd]) mkdirSync(dir, { recursive: true });
  for (const d of home) mkdirSync(join(fakeHome, d), { recursive: true });
  for (const d of project) mkdirSync(join(cwd, d), { recursive: true });

  const run = spawnSync(process.execPath, [BIN, "--dry-run"], {
    cwd,
    encoding: "utf8",
    // HOME on POSIX, USERPROFILE on Windows. Both are set because the second cannot be verified
    // from here — the Windows leg of CI is the check, and it has earned that role three times today.
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
  });
  return run.stdout + run.stderr;
}

const detectRoots = [];
after(() => {
  for (const dir of detectRoots) rmSync(dir, { recursive: true, force: true });
});

// The shape below is the one that DISCRIMINATES, and finding it took a measurement. Asserting
// "`.codex` in home produces an agents install" passes against a `detect` that ignores `.codex`
// entirely, because "detecting nothing is the normal first run" already falls back to agents — every
// such test asserts the same output as the fallback and none of them can fail.
//
// `.claude` is what suppresses the fallback: with it present, `detected.length > 0`, so the agents
// target appears ONLY if something actually detected it. Measured:
//
//     home=[]                    agents:yes  (fallback)
//     home=[".claude"]           agents:NO   claude:yes
//     home=[".claude",".codex"]  agents:yes  claude:yes   <- `.codex` is what turned it on
//
// So each source is tested alongside `.claude`, and the `.claude`-only case is the control.

test("with the fallback suppressed, a project .agents/ turns the agents target on", () => {
  assert.match(detectWith({ home: [".claude"], project: [".agents"] }), /\.agents[/\\]skills/);
});

test("with the fallback suppressed, a home .agents/ turns the agents target on", () => {
  assert.match(detectWith({ home: [".claude", ".agents"] }), /\.agents[/\\]skills/);
});

test("with the fallback suppressed, ~/.codex turns the agents target on", () => {
  assert.match(detectWith({ home: [".claude", ".codex"] }), /\.agents[/\\]skills/);
});

test("with the fallback suppressed, ~/.gemini turns the agents target on", () => {
  assert.match(detectWith({ home: [".claude", ".gemini"] }), /\.agents[/\\]skills/);
});

test("the control: .claude alone does NOT produce an agents install", () => {
  // Without this the four above prove nothing — it is the only case where the agents target is
  // absent, so it is the only thing that makes their presence meaningful.
  const output = detectWith({ home: [".claude"] });

  assert.match(output, /\.claude[/\\]skills/);
  assert.doesNotMatch(output, /\.agents[/\\]skills/);
});
