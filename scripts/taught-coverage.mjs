#!/usr/bin/env node
// Compare the @theokit packages the skills TEACH against the ones actually INSTALLED.
//
// This lived as an inline `node -e` script inside `.github/workflows/sdk-drift.yml`, where it
// printed a number and nothing read it — B-010. Two things are wrong with a string of JavaScript
// inside YAML: nothing can test it, and it carried its OWN import extractor, which is the third one
// in this repository after B-008 unified the two in `tests/`. Both problems disappear by making it
// a file.
//
// It imports from `tests/`, which is an unusual direction for a script. The alternative is worse:
// `lib/` and `bin/` are in package.json `files`, so anything placed there ships to every consumer
// of @theokit/skills, and a CI helper is not something users should download. See ADR-1 of
// `records/plans/assert-taught-coverage-plan.md`.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { fileURLToPath, pathToFileURL } from "node:url";

import { readSkill, skillFiles, specifiersIn } from "../tests/_skills.mjs";

// The repository root, derived from this file rather than from the cwd. `taughtPackages()` already
// resolves `skills/` module-relatively (via tests/_skills.mjs); `installedVersions()` used
// `process.cwd()`, so running the script from anywhere but the repo root produced a confident,
// entirely false seven-package diagnosis. CI always runs from the root; a human reproducing a
// failure does not. (F-dt-3)
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The @theokit package names the skills teach, as bare `@scope/name` (subpaths collapsed). */
export function taughtPackages(files = skillFiles()) {
  const names = new Set();
  for (const file of files) {
    for (const specifier of specifiersIn(readSkill(file))) {
      names.add(specifier.split("/").slice(0, 2).join("/"));
    }
  }
  return names;
}

/** Those of `names` present under node_modules, mapped to the version on disk. */
export function installedVersions(names, root = REPO_ROOT) {
  const found = new Map();
  for (const name of names) {
    const manifest = join(root, "node_modules", ...name.split("/"), "package.json");
    if (!existsSync(manifest)) continue;
    found.set(name, JSON.parse(readFileSync(manifest, "utf8")).version);
  }
  return found;
}

/**
 * Parse `@scope/name@1.2.3 other@4.5.6` into a Map. The separator is the LAST `@`, not the first.
 *
 * A token carrying no version is NOT dropped. Dropping it made the package report `not-resolved`,
 * whose remedy is "add it to TAUGHT_PACKAGES" — a confident wrong instruction, since it is already
 * there. The Map carries a `malformed` array so the caller can say so instead of guessing.
 */
export function parseResolved(line) {
  const out = new Map();
  const malformed = [];
  for (const token of (line ?? "").trim().split(/\s+/).filter(Boolean)) {
    const at = token.lastIndexOf("@");
    const version = at > 0 ? token.slice(at + 1) : "";
    if (at <= 0 || version === "") {
      malformed.push(token);
      continue;
    }
    out.set(token.slice(0, at), version);
  }
  out.malformed = malformed;
  return out;
}

/**
 * The comparison — pure, so it can be tested without a node_modules tree.
 *
 * It asks whether each taught package is present AT THE VERSION THIS RUN RESOLVED, not merely
 * whether it is present. Presence was the first implementation's question and it was vacuous:
 * dispatched run 33128039399 shrank the install list to one package and still saw all seven on
 * disk, because `npm install --no-save <pkg>` also installs package.json's dependencies and all
 * seven are devDependencies. Six came from the lockfile, at versions that by construction cannot
 * have moved — which is the gap the job exists to close, arriving through a side door.
 *
 * Three causes, because each has a different remedy:
 *   not-resolved  — the package is not in TAUGHT_PACKAGES; whatever is on disk came from the
 *                   lockfile, so this job never asked the registry about it
 *   not-installed — it was resolved but is absent; the install did not produce it
 *   shadowed      — it is present at a DIFFERENT version than resolved; the lockfile won
 */
export function coverage(taught, installed, resolved) {
  const problems = [];

  // An empty corpus is not "nothing to check" — it is the corpus missing. Reporting it clean is the
  // same mistake as reporting an empty `resolved` clean, in the other input. EC-1.
  if (taught.size === 0) {
    return {
      taught: 0,
      installed: installed.size,
      problems: [{ name: "(the skills corpus)", kind: "empty-corpus" }],
      ok: false,
    };
  }

  for (const name of [...taught].sort()) {
    const want = resolved.get(name);
    const onDisk = installed.get(name);
    if (!want) problems.push({ name, kind: "not-resolved", onDisk });
    else if (!onDisk) problems.push({ name, kind: "not-installed", want });
    else if (onDisk !== want) problems.push({ name, kind: "shadowed", want, onDisk });
  }
  return { taught: taught.size, installed: installed.size, problems, ok: problems.length === 0 };
}

const REMEDY = {
  "not-resolved":
    "not in TAUGHT_PACKAGES — whatever is on disk came from the lockfile, so this run never asked the registry about it",
  "not-installed": "resolved but absent from node_modules — the install did not produce it",
  "shadowed": "present at a different version than resolved — the lockfile won over @latest",
  "empty-corpus":
    "no skill teaches any @theokit package — the corpus is empty, unreadable, or the extractor broke. Refusing to report a clean result over nothing.",
};

/**
 * The closing advice, chosen by cause rather than issued blanket.
 *
 * It used to say "add the missing names to TAUGHT_PACKAGES" for every failure. That is the wrong
 * instruction for two of the four causes, and for an empty corpus it points at a file that cannot
 * possibly fix it (F-xval-4) — telling a reader confidently to do the wrong thing, which is the
 * defect T1.3 removed one branch over. Extracted from `main()` because the CLI path to an empty
 * corpus is unreachable from a test: `taughtPackages()` resolves `skills/` module-relatively, so no
 * choice of cwd empties it. A behaviour worth asserting has to be reachable by an assertion.
 */
export function closingAdvice(problems) {
  if (problems.some((p) => p.kind === "empty-corpus")) {
    return [
      "  Nothing was measured. This is not about the install list — check that `skills/` is",
      "  present and readable, and that the import extractor still recognises the corpus.",
    ];
  }
  if (problems.some((p) => p.kind === "not-resolved")) {
    return [
      "  Add the names listed above to TAUGHT_PACKAGES in .github/workflows/sdk-drift.yml.",
      "  Until then this job measures a smaller surface than the skills teach, and the",
      "  packages it skips can remove an export without anything noticing.",
    ];
  }
  return ["  See the per-package line above — each cause has its own remedy."];
}

function main(argv = process.argv.slice(2)) {
  // Two behaviours, and the separation is load-bearing. ADR-2 of the plan gives the workflow one
  // step that can NEVER fail (a report that fails is a report that can silence an alert) and one
  // whose only purpose is to fail. That separation lived in the YAML and not here, so the report
  // step invoked the assertion without `RESOLVED` and exited 1 on every single run — swallowed by
  // `continue-on-error`, printing a misleading mismatch into a green job. Found by reading the log
  // of run 33130141734 rather than its `conclusion`, which `continue-on-error` had marked success.
  // Unknown input is rejected, not ignored. The mode lives as an argv string in a YAML file that
  // nothing tests, so `--asert` would otherwise print an inventory and exit 0 — the gate turned off
  // with no signal, which is the exact failure this item exists to remove. Exit 2 rather than 1:
  // a broken invocation is not a bookkeeping mismatch, and a reader must be able to tell them
  // apart. (F-dom-9, /review.)
  const unknown = argv.filter((a) => a !== "--assert");
  if (unknown.length) {
    console.error(`taught-coverage: unrecognised argument(s): ${unknown.join(", ")}`);
    console.error("  usage: taught-coverage.mjs [--assert]");
    console.error("  Refusing to run: an unrecognised flag must not look like report mode.");
    return 2;
  }
  const asserting = argv.includes("--assert");

  const taught = taughtPackages();
  const installed = installedVersions(taught);
  const resolved = parseResolved(process.env.RESOLVED ?? "");

  if (!asserting) {
    // Report mode: the inventory, and nothing that can fail.
    console.log(
      `taught-surface-coverage: ${installed.size}/${taught.size} taught packages present in node_modules`,
    );
    for (const [name, version] of [...installed].sort()) console.log(`  ${name}@${version}`);
    return 0;
  }

  // Assert mode: the verdict only. The listing was printed by the step above, and repeating it
  // would bury the one line a human should read. That line MUST reach stdout: while it was
  // discarded, the only observable in a green run was `taught-surface-coverage: N/M present in
  // node_modules` — the PRESENCE metric ADR-3 refutes — so the change published the very number it
  // was written to replace (F-wire-2).

  // An empty `resolved` is not "nothing to check" — it is the input missing. Treating it as clean
  // is the vacuity that caused this file to be rewritten, so it fails instead.
  if (resolved.malformed?.length) {
    console.error("");
    console.error("BOOKKEEPING MISMATCH — this is not API drift.");
    console.error("  The install step's resolved output carries token(s) with no version:");
    for (const token of resolved.malformed) console.error(`    ${token}`);
    console.error("  Nothing can be verified against a truncated list, so this fails rather than");
    console.error("  reporting the packages it cannot see as merely absent from TAUGHT_PACKAGES.");
    return 1;
  }

  if (resolved.size === 0) {
    console.error("");
    console.error("BOOKKEEPING MISMATCH — this is not API drift.");
    console.error("  RESOLVED is empty: the install step's resolved-version output did not reach");
    console.error("  this step, so nothing can be verified. Refusing to report a clean result.");
    return 1;
  }

  const result = coverage(taught, installed, resolved);
  if (result.ok) {
    console.log(`all ${result.taught} taught package(s) resolved by this run and matching on disk`);
    return 0;
  }

  // The literal below is load-bearing: it tells a reader this is NOT the drift the job detects.
  // An API-drift failure comes from `npm test` and never prints it.
  console.error("");
  console.error("BOOKKEEPING MISMATCH — this is not API drift.");
  console.error(`  ${result.problems.length} of ${result.taught} taught package(s) were not verified:`);
  for (const p of result.problems) {
    const versions = p.kind === "shadowed" ? ` (on disk ${p.onDisk}, resolved ${p.want})` : "";
    console.error(`    ${p.name}${versions}`);
    console.error(`      ${REMEDY[p.kind]}`);
  }
  console.error("");
  for (const line of closingAdvice(result.problems)) console.error(line);
  return 1;
}

// `pathToFileURL`, not a hand-built `file://` string: on Windows the two differ
// (`file://D:\a\...` vs `file:///D:/a/...`), the guard is false, `main()` never runs, and the
// process exits 0 having printed nothing. `ci.yml` runs this suite on `windows-latest`, and three
// tests here spawn this file as a CLI — so the hand-built form would have failed there while
// passing everywhere it was tried. Stdlib does it (parsimony rung 2). Found by /review, F-arch-4.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // `process.exitCode`, not `process.exit()`. A step's stdout is a pipe, writes to a pipe are
  // asynchronous, and `process.exit()` terminates without flushing them. The report step exists
  // solely to emit lines, and assert mode now insists its verdict reaches stdout — so the one thing
  // both steps depend on is the thing `exit()` can truncate. Latent today (the output fits the 64KB
  // buffer) and it bites the day the taught set grows. Same status code, Node drains first.
  process.exitCode = main();
}
