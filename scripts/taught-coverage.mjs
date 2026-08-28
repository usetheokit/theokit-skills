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

import { readSkill, skillFiles, specifiersIn } from "../tests/_skills.mjs";

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
export function installedVersions(names, root = process.cwd()) {
  const found = new Map();
  for (const name of names) {
    const manifest = join(root, "node_modules", ...name.split("/"), "package.json");
    if (!existsSync(manifest)) continue;
    found.set(name, JSON.parse(readFileSync(manifest, "utf8")).version);
  }
  return found;
}

/** Parse `@scope/name@1.2.3 other@4.5.6` into a Map. The separator is the LAST `@`, not the first. */
export function parseResolved(line) {
  const out = new Map();
  for (const token of (line ?? "").trim().split(/\s+/).filter(Boolean)) {
    const at = token.lastIndexOf("@");
    if (at <= 0) continue;
    out.set(token.slice(0, at), token.slice(at + 1));
  }
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
};

function main() {
  const taught = taughtPackages();
  const installed = installedVersions(taught);
  const resolved = parseResolved(process.env.RESOLVED ?? "");

  console.log(
    `taught-surface-coverage: ${installed.size}/${taught.size} taught packages present in node_modules`,
  );
  for (const [name, version] of [...installed].sort()) console.log(`  ${name}@${version}`);

  // An empty `resolved` is not "nothing to check" — it is the input missing. Treating it as clean
  // is the vacuity that caused this file to be rewritten, so it fails instead.
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
  console.error("  Add the missing names to TAUGHT_PACKAGES in .github/workflows/sdk-drift.yml.");
  console.error("  Until then this job measures a smaller surface than the skills teach, and the");
  console.error("  packages it skips can remove an export without anything noticing.");
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
