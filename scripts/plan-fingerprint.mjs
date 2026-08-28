#!/usr/bin/env node
// A fingerprint of the plan a commit was written against, for a repository that cannot version its
// plans.
//
// `.claude/` is never versioned here — it is installed tooling, not project source — so a plan has
// no history and no diff. Measured during `/review` of B-005: the plan's mtime was 114 seconds AFTER
// the commit it governed, every acceptance criterion in it passed when executed, and nothing in the
// repository could distinguish "the plan was corrected" from "the plan was moved to match what was
// built". Three reviewers hit the same wall independently.
//
// The commit MESSAGE is versioned even when the file is not. So the commit carries the plan's
// SHA-256, and a later edit becomes detectable without versioning anything new.
//
// What this does NOT prove — and no mechanism inside this repository can — is that the plan existed
// BEFORE the work. A plan written afterwards and committed with its own correct hash passes cleanly.
// That limit is stated in RELEASING.md rather than left for a reader to discover.

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Sixteen hex characters of SHA-256 over the file's bytes. */
export function fingerprint(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16);
}

/**
 * The fingerprint, or why it could not be taken.
 *
 * `existsSync` answers existence, not readability. A directory at the plan path — or a permission
 * error — threw an uncaught `EISDIR`/`EACCES` and exited **1**, which is the code for "the plan
 * changed". A CI step running the documented one-liner would then announce plan drift for a plan
 * nobody touched. The comment beside that check promised "named, never thrown"; it now is.
 * (F-2, /review.)
 */
export function readFingerprint(file) {
  try {
    return { kind: "ok", digest: fingerprint(file) };
  } catch (error) {
    return { kind: "unreadable", code: error.code ?? "ERR", message: error.message };
  }
}

const PLANS_DIR = join(REPO_ROOT, ".claude", "records", "plans");

/**
 * The plan file for a slug, or `undefined` when the slug would escape the plans directory.
 *
 * `../../../tmp/evil` used to resolve, read and print "matches the plan on disk" with exit 0 — a
 * confident green about the wrong file, where every other bad slug got exit 2. The slug is
 * developer-typed, so this is a correctness boundary rather than a privilege one; a tool whose
 * entire purpose is refusing confident wrong answers should not ship one. (F-3, /review.)
 */
export function planPath(slug) {
  const candidate = resolve(PLANS_DIR, `${slug}-plan.md`);
  return candidate.startsWith(`${PLANS_DIR}${sep}`) ? candidate : undefined;
}

/**
 * Compare a recorded fingerprint against the plan on disk.
 *
 * Three answers, not two. `absent` is what a commit carrying no trailer gets, and collapsing it into
 * "not a mismatch" would be a clean result over a state nobody checked — the defect this project has
 * shipped twice this month in other gates.
 */
export function verify(file, recorded) {
  if (recorded === undefined || recorded === "") return { kind: "absent" };
  const actual = fingerprint(file);
  return recorded === actual
    ? { kind: "match", recorded, actual }
    : { kind: "mismatch", recorded, actual };
}

const HEX16 = /^[0-9a-f]{16}$/;

function main(argv = process.argv.slice(2)) {
  const slug = argv.find((a) => !a.startsWith("--"));
  if (slug === undefined) {
    console.error("usage: plan-fingerprint.mjs <slug> [--verify <16-hex>]");
    return 3;
  }

  const file = planPath(slug);
  if (file === undefined) {
    console.error(`plan-fingerprint: "${slug}" is not a plan slug — it resolves outside the plans directory.`);
    return 2;
  }
  if (!existsSync(file)) {
    // EC-1: named, never thrown. A tool whose failure mode is a stack trace gets wrapped in
    // `|| true` by the first person who scripts it, and then its answer is silence.
    console.error(`plan-fingerprint: no plan for "${slug}" at ${relative(REPO_ROOT, file)}`);
    return 2;
  }

  const read = readFingerprint(file);
  if (read.kind === "unreadable") {
    console.error(`plan-fingerprint: cannot read ${relative(REPO_ROOT, file)} (${read.code}).`);
    console.error("  This is not drift — the plan was never compared.");
    return 2;
  }

  const at = argv.indexOf("--verify");
  if (at === -1) {
    console.log(`Plan-SHA256: ${read.digest} (${relative(REPO_ROOT, file)})`);
    return 0;
  }

  const recorded = argv[at + 1];
  // An EMPTY argument is the ABSENT case, not a malformed one: `--verify` is fed by a `sed` over the
  // commit body, and a commit carrying no trailer yields "". Calling that malformed sent the reader
  // to check their pipeline instead of their commit — and it made `verify()`'s `absent` branch
  // unreachable from here, a branch with a test and no production caller. (F-1, /review.)
  if (recorded === undefined || recorded === "") {
    console.error(`plan-fingerprint: this commit records no Plan-SHA256 trailer for "${slug}".`);
    console.error("  Absent is not a pass: nothing was compared. Add the trailer, or say why not.");
    return 4;
  }
  // EC-3: a non-empty argument that is not a fingerprint is a typo or a broken extraction, and is
  // neither a mismatch nor an absence.
  if (!HEX16.test(recorded)) {
    console.error(
      `plan-fingerprint: --verify expects 16 hex characters, got ${JSON.stringify(recorded ?? null)}.`,
    );
    console.error("  This is malformed input, not a mismatch — the plan was not compared.");
    return 3;
  }

  const result = verify(file, recorded);
  if (result.kind === "match") {
    console.log(`plan-fingerprint: ${slug} matches the plan on disk (${result.actual})`);
    return 0;
  }
  console.error(`plan-fingerprint: ${slug} DOES NOT match the plan on disk.`);
  console.error(`  the commit recorded : ${result.recorded}`);
  console.error(`  the plan is now     : ${result.actual}`);
  console.error("  The plan changed after the commit that cited it. That may be a correction — but");
  console.error("  nothing here can tell a correction from a plan moved to match what was built.");
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
