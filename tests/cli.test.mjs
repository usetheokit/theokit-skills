/**
 * The installer, end to end, in a throwaway project.
 *
 * This is the test that answers "does it work on Windows, macOS and Linux?" — by being run on all
 * three in CI. It spawns the real bin, in a real temp directory, and asserts the files an agent
 * would go looking for are there and readable.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
