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

/**
 * The comparison itself — pure, so it can be tested without a node_modules tree.
 * `missing` names the packages rather than counting them: a count tells you something is wrong and
 * not what to do about it, and B-010's DoD asks for the names.
 */
export function coverage(taught, installed) {
  const missing = [...taught].filter((name) => !installed.has(name)).sort();
  return { taught: taught.size, installed: installed.size, missing, ok: missing.length === 0 };
}

function main() {
  const taught = taughtPackages();
  const installed = installedVersions(taught);
  const result = coverage(taught, installed);

  console.log(
    `taught-surface-coverage: ${result.installed}/${result.taught} taught packages present in node_modules`,
  );
  for (const [name, version] of [...installed].sort()) console.log(`  ${name}@${version}`);
  if (result.ok) return 0;

  // The literal below is load-bearing: it is what tells a reader that this is NOT the drift this
  // job exists to detect. An API-drift failure comes from `npm test` and never prints this line.
  console.error("");
  console.error("BOOKKEEPING MISMATCH — this is not API drift.");
  console.error(
    `  The skills teach ${result.taught} @theokit package(s); only ${result.installed} were installed.`,
  );
  console.error("  Missing from the install:");
  for (const name of result.missing) console.error(`    ${name}`);
  console.error("");
  console.error("  Add them to TAUGHT_PACKAGES in .github/workflows/sdk-drift.yml.");
  console.error("  Until then this job measures a smaller surface than the skills teach, and the");
  console.error("  packages it skips can remove an export without anything noticing.");
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
