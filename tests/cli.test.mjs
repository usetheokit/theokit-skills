/**
 * The installer, end to end, in a throwaway project.
 *
 * This is the test that answers "does it work on Windows, macOS and Linux?" — by being run on all
 * three in CI. It spawns the real bin, in a real temp directory, and asserts the files an agent
 * would go looking for are there and readable.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(packageRoot, "bin", "install.mjs");

const roots = [];
function project() {
  const dir = mkdtempSync(join(tmpdir(), "theokit-cli-"));
  roots.push(dir);
  return dir;
}
after(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

/** Run the installer in `cwd`. Returns stdout; throws with stderr attached on a non-zero exit. */
function run(cwd, args = []) {
  return execFileSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });
}
function runExpectingFailure(cwd, args) {
  try {
    run(cwd, args);
    return undefined;
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("with no agent configured, it installs where the most tools read", () => {
  const cwd = project();
  const out = run(cwd, ["--target=agents"]);
  assert.match(out, /\.agents\/skills/);
  assert.ok(existsSync(join(cwd, ".agents", "skills", "theokit-sdk", "SKILL.md")));
});

test("a project with .claude/ gets the Claude target detected", () => {
  const cwd = project();
  mkdirSync(join(cwd, ".claude"), { recursive: true });
  run(cwd);
  assert.ok(existsSync(join(cwd, ".claude", "skills", "theokit-sdk", "SKILL.md")));
});

test("the installed SKILL.md is byte-identical to the bundled one", () => {
  const cwd = project();
  run(cwd, ["--target=agents"]);
  assert.equal(
    readFileSync(join(cwd, ".agents", "skills", "theokit-sdk", "SKILL.md"), "utf8"),
    readFileSync(join(packageRoot, "skills", "theokit-sdk", "SKILL.md"), "utf8"),
  );
});

test("a second run is a no-op and says so", () => {
  const cwd = project();
  run(cwd, ["--target=agents"]);
  const out = run(cwd, ["--target=agents"]);
  assert.match(out, /kept \(use --force to replace\)/);
});

test("--dry-run writes nothing", () => {
  const cwd = project();
  run(cwd, ["--target=agents", "--dry-run"]);
  assert.equal(existsSync(join(cwd, ".agents")), false);
  assert.equal(existsSync(join(cwd, ".theokit-skills.json")), false);
});

test("--check fails before an install and passes after one", () => {
  const cwd = project();

  const before = runExpectingFailure(cwd, ["--target=agents", "--check"]);
  assert.equal(before?.status, 1, "never installed is a drift failure, not a pass");
  assert.match(before.stderr, /DRIFT/);

  run(cwd, ["--target=agents"]);
  const after = run(cwd, ["--target=agents", "--check"]);
  assert.match(after, /up to date/);
});

test("--check catches an installed skill that was deleted", () => {
  const cwd = project();
  run(cwd, ["--target=agents"]);
  rmSync(join(cwd, ".agents", "skills", "theokit-sdk"), { recursive: true, force: true });

  const result = runExpectingFailure(cwd, ["--target=agents", "--check"]);
  assert.equal(result?.status, 1);
  assert.match(result.stderr, /no longer exist/);
});

test("the manifest records what landed, and is committable JSON", () => {
  const cwd = project();
  run(cwd, ["--target=agents"]);
  const manifest = JSON.parse(readFileSync(join(cwd, ".theokit-skills.json"), "utf8"));
  assert.equal(manifest.package, "@theokit/skills");
  assert.ok(manifest.entries.length > 0);
  for (const entry of manifest.entries) {
    assert.ok(["link", "copy"].includes(entry.mode), "every entry declares how it was installed");
  }
});

test("an unknown target is refused by name instead of silently ignored", () => {
  const result = runExpectingFailure(project(), ["--target=nope"]);
  assert.equal(result?.status, 2);
  assert.match(result.stderr, /no such target/);
});

test("an unknown option is refused rather than treated as a default run", () => {
  const result = runExpectingFailure(project(), ["--instal"]);
  assert.equal(result?.status, 2);
  assert.match(result.stderr, /unknown option/);
});

test("--help lists every target and the tools it serves", () => {
  const out = run(project(), ["--help"]);
  for (const id of ["agents", "claude", "github"]) assert.match(out, new RegExp(id));
  assert.match(out, /Claude Code/);
  assert.match(out, /OpenAI Codex/);
});

// ── The gate, through the binary a user runs ─────────────────────────────────────────────────────
//
// W-02 (/review): deleting content-drift detection outright — `drift()` returning `current`
// unconditionally — left every test in THIS file green. The unit suite caught it and the CLI suite,
// which is what ships, did not. The plan declared this integration test and the implementation
// shipped without it.
//
// W-03: the headline defect T1.2 was written to fix — a bare `--check` reporting false DRIFT — had
// no test at any level, because every `--check` in the suite passed `--target=agents`.

test("a bare --check passes after a targeted install, whatever else the machine has", () => {
  // Measured before the fix: exit 1, because `--check` rebuilt its expectation from the targets
  // DETECTED on the machine rather than from the manifest. Anyone who trusted it in CI had to pass
  // `--target` to make it pass, silently narrowing what was checked.
  const dir = project();
  run(dir, ["--target=agents"]);

  const bare = spawnSync(process.execPath, [BIN, "--check"], { cwd: dir, encoding: "utf8" });

  assert.equal(bare.status, 0, `bare --check must not report drift about the machine:\n${bare.stderr}`);
  assert.match(bare.stdout, /up to date/);
});

test("--check fails, through the binary, when an installed file is edited", () => {
  const dir = project();
  run(dir, ["--target=agents"]);
  const manifest = JSON.parse(readFileSync(join(dir, ".theokit-skills.json"), "utf8"));
  const skill = join(dir, manifest.entries[0].path, "SKILL.md");

  appendFileSync(skill, "\n<!-- edited after install -->\n");
  const drifted = spawnSync(process.execPath, [BIN, "--check"], { cwd: dir, encoding: "utf8" });

  assert.equal(drifted.status, 1);
  assert.match(drifted.stderr, /no longer match this version/);
  assert.match(drifted.stderr, new RegExp(manifest.entries[0].skill));
});

test("installing a second tool keeps the first one inside the gate", () => {
  // W-01, the BLOCKER: the manifest was replaced rather than merged, so the earlier installation
  // stayed on disk and left the gate. `--check` answered "up to date — 31" over a tampered file.
  const dir = project();
  run(dir, ["--target=agents"]);
  run(dir, ["--target=claude"]);

  const manifest = JSON.parse(readFileSync(join(dir, ".theokit-skills.json"), "utf8"));
  const targets = new Set(manifest.entries.map((e) => e.target));
  assert.deepEqual([...targets].sort(), ["agents", "claude"]);

  const agentsEntry = manifest.entries.find((e) => e.target === "agents");
  appendFileSync(join(dir, agentsEntry.path, "SKILL.md"), "\n<!-- tampered -->\n");
  const after = spawnSync(process.execPath, [BIN, "--check"], { cwd: dir, encoding: "utf8" });

  assert.equal(after.status, 1, "the first tool's install must still be checked");
});

// ── B-022: a --global install writes a project-shaped manifest into whatever cwd you stood in ────
//
// Reproduced 2026-08-28: 31 entries whose paths read `../home/.agents/skills/theokit-agent-core`,
// in a directory chosen by nothing but where the operator happened to be. The file is committable,
// meaningless from anywhere else, and `--check` there measures a home install while appearing to
// describe the project it sits in.

/** A scratch HOME plus an unrelated cwd. `USERPROFILE` too — `homedir()` reads that on Windows, and
 *  a test that sets only `HOME` would install into the developer's REAL home there. (EC-1.) */
function personalScope() {
  const root = project();
  const home = join(root, "home");
  const elsewhere = join(root, "elsewhere");
  mkdirSync(home);
  mkdirSync(elsewhere);
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  return { home, elsewhere, env };
}

test("a --global install writes no manifest into the working directory", () => {
  const { home, elsewhere, env } = personalScope();
  // EC-2: `!existsSync(...)` passes trivially in a fresh directory — it would pass against a build
  // that writes nothing and against one that crashes before writing. The decoy makes the assertion
  // distinguish "correctly did not write here" from "did nothing".
  const decoy = join(elsewhere, ".theokit-skills.json");
  writeFileSync(decoy, '{"decoy":true}\n');

  execFileSync(process.execPath, [BIN, "--global", "--copy"], { cwd: elsewhere, encoding: "utf8", env });

  // EC-1: prove HOME took before believing anything about the manifest.
  assert.ok(existsSync(join(home, ".agents", "skills")), "the install did not land in the scratch home");
  assert.equal(JSON.parse(readFileSync(decoy, "utf8")).decoy, true, "the cwd manifest was overwritten");
  assert.ok(existsSync(join(home, ".theokit-skills.json")), "no manifest in the scope it describes");
});

test("a global manifest records paths that resolve from its own scope", () => {
  const { home, elsewhere, env } = personalScope();

  execFileSync(process.execPath, [BIN, "--global", "--copy"], { cwd: elsewhere, encoding: "utf8", env });

  const manifest = JSON.parse(readFileSync(join(home, ".theokit-skills.json"), "utf8"));
  assert.ok(manifest.entries.length > 0);
  for (const entry of manifest.entries) {
    // EC-3, and this is the assertion that would otherwise have shipped: the broken build wrote
    // `../home/.agents/skills/x`, which RESOLVES from a cwd that sits beside home — the exact layout
    // this fixture has. Existence alone passes on the defect. The absence of `..` is what encodes
    // "meaningful from its own scope"; existence only encodes the accident.
    assert.ok(!entry.path.split(/[\\/]/).includes(".."), `escaping path: ${entry.path}`);
    assert.ok(existsSync(join(home, entry.path)), `unresolvable from its own scope: ${entry.path}`);
  }
});

test("--check --global reports on the personal scope", () => {
  const { elsewhere, env } = personalScope();
  execFileSync(process.execPath, [BIN, "--global", "--copy"], { cwd: elsewhere, encoding: "utf8", env });

  const checked = spawnSync(process.execPath, [BIN, "--check", "--global"], {
    cwd: elsewhere, encoding: "utf8", env,
  });

  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /up to date/);
});

test("--check says when only a personal install exists", () => {
  const { elsewhere, env } = personalScope();
  execFileSync(process.execPath, [BIN, "--global", "--copy"], { cwd: elsewhere, encoding: "utf8", env });

  const checked = spawnSync(process.execPath, [BIN, "--check"], { cwd: elsewhere, encoding: "utf8", env });

  assert.notEqual(checked.status, 0, "a project check must not pass on a personal install");
  assert.match(checked.stderr, /personal/i, `the absent message hides the personal install: ${checked.stderr}`);
});

test("a project install still writes its manifest where it always did", () => {
  // EC-7. Splitting the scope is exactly the change that quietly relocates the common case.
  const dir = project();

  run(dir, ["--copy"]);

  const manifest = JSON.parse(readFileSync(join(dir, ".theokit-skills.json"), "utf8"));
  assert.ok(manifest.entries.length > 0);
  for (const entry of manifest.entries) {
    assert.ok(!entry.path.split(/[\\/]/).includes(".."), `escaping path: ${entry.path}`);
  }
});
