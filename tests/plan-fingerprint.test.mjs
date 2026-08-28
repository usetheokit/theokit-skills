import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fingerprint, readFingerprint, verify } from "../scripts/plan-fingerprint.mjs";

const CLI = fileURLToPath(new URL("../scripts/plan-fingerprint.mjs", import.meta.url));

// B-009. Plans live under `.claude/`, which this project never versions, so there is no history and
// no diff — a plan edited after the commit it governs is indistinguishable from one that was always
// right. Measured during `/review` of B-005: the plan's mtime was 114 seconds AFTER the commit it
// governed, every criterion in it passed, and nothing could tell "corrected" from "moved to match".
//
// The commit message IS versioned even when the file is not. A fingerprint in a trailer makes a
// later edit detectable without versioning `.claude/`.

/**
 * A plan file inside the repository's real plans directory, created and removed by the test.
 *
 * The CLI resolves the plans directory from its own module location, so a CLI-level test needs a
 * plan to exist THERE. It cannot use a committed one: `.claude/` is gitignored, which is the very
 * thing this item is about — and the first version of these tests pointed at
 * `plan-fingerprint-plan.md` and passed only on the machine that had it. CI failed on all three
 * platforms, which is the correct outcome for a test that cannot run anywhere else.
 */
function planInRepo(body) {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", ".claude", "records", "plans");
  mkdirSync(dir, { recursive: true });
  const slug = `zz-fingerprint-fixture-${process.pid}`;
  const file = join(dir, `${slug}-plan.md`);
  writeFileSync(file, body);
  return { slug, file, cleanup: () => rmSync(file, { force: true }) };
}

function scratchPlan(body) {
  const root = mkdtempSync(join(tmpdir(), "fingerprint-"));
  const dir = join(root, ".claude", "records", "plans");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "demo-plan.md");
  writeFileSync(file, body);
  return { root, file };
}

test("identical bytes fingerprint identically, and one character changes it", () => {
  const { root, file } = scratchPlan("# Plan\n\nGoal: something.\n");
  try {
    const before = fingerprint(file);
    assert.match(before, /^[0-9a-f]{16}$/);
    assert.equal(fingerprint(file), before, "the same bytes must give the same answer");

    appendFileSync(file, "x");

    assert.notEqual(fingerprint(file), before, "one appended character IS the detection");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("verify reports match, mismatch with both values, and absent — three answers, not two", () => {
  const { root, file } = scratchPlan("# Plan\n");
  try {
    const good = fingerprint(file);

    assert.deepEqual(verify(file, good), { kind: "match", recorded: good, actual: good });

    const bad = verify(file, "0000000000000000");
    assert.equal(bad.kind, "mismatch");
    assert.equal(bad.recorded, "0000000000000000");
    assert.equal(bad.actual, good, "a mismatch must name BOTH values, or nobody can act on it");

    // absent is not mismatch: a commit that carries no trailer was never checked, and reporting
    // "not a mismatch" for it would be a clean result over an unverified state.
    assert.equal(verify(file, undefined).kind, "absent");
    assert.equal(verify(file, "").kind, "absent");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an absent plan is named, not thrown", () => {
  // EC-1: a tool whose failure mode is a stack trace gets wrapped in `|| true` by the first person
  // who scripts it, and then its answer is silence.
  const run = spawnSync(process.execPath, [CLI, "no-such-slug"], { encoding: "utf8" });

  assert.equal(run.status, 2);
  assert.match(run.stderr, /no-such-slug/);
  assert.doesNotMatch(run.stderr, /^\s+at .+:\d+:\d+\)?$/m, "no stack frame");
});

test("a malformed --verify argument is refused, distinctly from a mismatch", () => {
  // EC-3: `--verify` takes its argument from a `sed` in a shell pipeline, and a pipeline that
  // matches nothing passes an EMPTY STRING. Comparing that to a real hash is a mismatch — which
  // reads as "the plan was edited" when what failed was the extraction.
  //
  // "" is NOT in this list, and that is a design change rather than a test being bent: an empty
  // argument is the `absent` case (exit 4), asserted separately.
  const { slug, cleanup } = planInRepo("# Fixture\n");
  try {
    for (const argument of ["zz", "abc", "0123456789abcdefg"]) {
      const run = spawnSync(process.execPath, [CLI, slug, "--verify", argument], { encoding: "utf8" });
      assert.equal(run.status, 3, `\`--verify ${JSON.stringify(argument)}\` must be refused, not compared`);
    }
  } finally {
    cleanup();
  }
});

test("the tool prints a trailer for a plan in the repository's plans directory", () => {
  const { slug, cleanup } = planInRepo("# Fixture\n\nGoal: exist.\n");
  try {
    const run = spawnSync(process.execPath, [CLI, slug], { encoding: "utf8" });

    assert.equal(run.status, 0, run.stderr);
    assert.match(
      run.stdout,
      new RegExp(`^Plan-SHA256: [0-9a-f]{16} \\(.claude/records/plans/${slug}-plan\\.md\\)$`, "m"),
    );
  } finally {
    cleanup();
  }
});

test("a commit with no trailer is `absent` through the CLI, not `malformed`", () => {
  // F-1 (/review, HIGH): the doc promised exit 2 for "no trailer", the CLI gave 3 with a message
  // about malformed input, and `verify()`'s `absent` branch was unreachable from `main()` — a branch
  // with a test and no production caller, which is the wiring defect this repository hunts.
  //
  // The distinction is not pedantry. `--verify` takes its argument from a `sed` over the commit
  // body; a commit with no trailer yields an EMPTY STRING, and that is the *absent* case, not a
  // typo. Calling it malformed sends the reader to check their pipeline instead of their commit.
  const { slug, cleanup } = planInRepo("# Fixture\n");
  const absent = spawnSync(process.execPath, [CLI, slug, "--verify", ""], {
    encoding: "utf8",
  });
  assert.equal(absent.status, 4, "no trailer is its own answer");
  assert.match(absent.stderr, /no .*trailer/i);

  const malformed = spawnSync(process.execPath, [CLI, slug, "--verify", "zz"], { encoding: "utf8" });
  assert.equal(malformed.status, 3, "a typo is still malformed");
  cleanup();
});

test("a plan path that cannot be read is reported, not thrown as drift", () => {
  // F-2 (/review): `existsSync` answers existence, not readability. A directory at the plan path
  // threw an uncaught EISDIR and exited 1 — the SAME code as "the plan changed" — so a CI step
  // running the documented one-liner would announce drift for a plan nobody touched. The comment
  // above that check promised "named, never thrown".
  //
  // Tested at the library boundary, because the CLI resolves its root from the module's own
  // location. A first version of this test pointed an env var the tool does not read at a scratch
  // directory, so the tool looked in the real repository, found nothing, and exited 2 — the test
  // passed for entirely the wrong reason.
  const root = mkdtempSync(join(tmpdir(), "fingerprint-dir-"));
  try {
    const asDirectory = join(root, "adirectory-plan.md");
    mkdirSync(asDirectory, { recursive: true });

    const result = readFingerprint(asDirectory);

    assert.equal(result.kind, "unreadable");
    assert.equal(result.code, "EISDIR");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a slug cannot reach outside the plans directory", () => {
  // F-3 (/review): `../../../tmp/evil` printed "matches the plan on disk", exit 0, over a planted
  // file — a confident green about the wrong file, where every other bad slug gets exit 2. Not a
  // privilege boundary (the slug is developer-typed), but this tool exists to refuse confident
  // wrong answers, so shipping one would be a poor joke.
  const run = spawnSync(process.execPath, [CLI, "../../../../../../tmp/whatever"], { encoding: "utf8" });

  assert.equal(run.status, 2);
  assert.match(run.stderr, /outside|not a plan slug/i);
});

test("the printed path uses forward slashes on every platform", () => {
  // Windows CI caught this, and it is the THIRD time in this session I shipped a path built with
  // the platform separator where a stable form was needed. The other two were `endsWith("/x/y")`
  // matches; this one was output. A trailer whose shape depends on the machine that produced it is
  // worse for the humans who read and grep them, even though the hash — which is what the mechanism
  // actually compares — is unaffected.
  const { slug, cleanup } = planInRepo("# Fixture\n");
  try {
    const run = spawnSync(process.execPath, [CLI, slug], { encoding: "utf8" });

    assert.doesNotMatch(run.stdout, /\\/, "no backslash in a path this project prints");
    assert.match(run.stdout, /\(\.claude\/records\/plans\//);
  } finally {
    cleanup();
  }
});
