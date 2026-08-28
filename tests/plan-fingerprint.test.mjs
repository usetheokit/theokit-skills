import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fingerprint, verify } from "../scripts/plan-fingerprint.mjs";

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
  for (const argument of ["", "zz", "abc", "0123456789abcdefg"]) {
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
