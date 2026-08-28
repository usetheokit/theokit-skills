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
  // "" is NOT in this list any more, and the change is a design change rather than a test being
  // bent: an empty argument is what a `sed` yields for a commit with NO TRAILER, so it is the
  // `absent` case (exit 4), asserted in its own test below. Everything non-empty that is not a
  // fingerprint is a typo or a broken extraction.
  for (const argument of ["zz", "abc", "0123456789abcdefg"]) {
    const run = spawnSync(process.execPath, [CLI, "plan-fingerprint", "--verify", argument], {
      encoding: "utf8",
    });
    assert.equal(run.status, 3, `\`--verify ${JSON.stringify(argument)}\` must be refused, not compared`);
  }
});

test("the tool prints a trailer for a real plan in this repository", () => {
  const run = spawnSync(process.execPath, [CLI, "plan-fingerprint"], { encoding: "utf8" });

  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^Plan-SHA256: [0-9a-f]{16} \(.claude\/records\/plans\/plan-fingerprint-plan\.md\)$/m);
});

test("a commit with no trailer is `absent` through the CLI, not `malformed`", () => {
  // F-1 (/review, HIGH): the doc promised exit 2 for "no trailer", the CLI gave 3 with a message
  // about malformed input, and `verify()`'s `absent` branch was unreachable from `main()` — a branch
  // with a test and no production caller, which is the wiring defect this repository hunts.
  //
  // The distinction is not pedantry. `--verify` takes its argument from a `sed` over the commit
  // body; a commit with no trailer yields an EMPTY STRING, and that is the *absent* case, not a
  // typo. Calling it malformed sends the reader to check their pipeline instead of their commit.
  const absent = spawnSync(process.execPath, [CLI, "plan-fingerprint", "--verify", ""], {
    encoding: "utf8",
  });
  assert.equal(absent.status, 4, "no trailer is its own answer");
  assert.match(absent.stderr, /no .*trailer/i);

  const malformed = spawnSync(process.execPath, [CLI, "plan-fingerprint", "--verify", "zz"], {
    encoding: "utf8",
  });
  assert.equal(malformed.status, 3, "a typo is still malformed");
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
