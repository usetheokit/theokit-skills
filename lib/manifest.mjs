// A record of what was installed, so a second run is a no-op and CI can tell when it went stale.
//
// WHY THIS EXISTS. The failure this guards is not a crash — it is an installed skill that keeps
// teaching last year's API. An out-of-date instruction is worse than a missing one: the agent
// follows it with the same diligence as a current one, and nothing surfaces the divergence. This
// is the single most-cited criticism of shipping instruction files, and `--check` is the answer to
// it: a CI job that fails when the skills in the tree no longer match the installed package.
//
// The file is small and human-readable on purpose. It is meant to be committed alongside the
// skills it describes.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MANIFEST_NAME = ".theokit-skills.json";

/** Schema version. A bump means "wipe and reinstall", never "silently migrate". */
const SCHEMA = 1;

export function manifestPath(projectRoot) {
  return join(projectRoot, MANIFEST_NAME);
}

/** Read the manifest, or `undefined` when absent or from an older schema. */
export function readManifest(projectRoot) {
  const path = manifestPath(projectRoot);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed?.schema === SCHEMA ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function writeManifest(projectRoot, { version, entries }) {
  const body = {
    schema: SCHEMA,
    package: "@theokit/skills",
    version,
    // Sorted so the file is stable across runs and diffs stay readable.
    entries: [...entries].sort((a, b) => `${a.skill}${a.target}`.localeCompare(`${b.skill}${b.target}`)),
  };
  writeFileSync(manifestPath(projectRoot), `${JSON.stringify(body, null, 2)}\n`);
  return body;
}

/**
 * What is out of date, given the manifest on disk and the package being run.
 *
 * Reports three distinct states rather than a boolean, because the fixes differ: never installed,
 * installed from a different version, or installed but the files are gone.
 */
export function drift(projectRoot, { version, expected }) {
  const manifest = readManifest(projectRoot);
  if (manifest === undefined) return { kind: "absent" };
  if (manifest.version !== version) {
    return { kind: "version", installed: manifest.version, current: version };
  }
  const missing = expected.filter((entry) => !existsSync(entry.path));
  return missing.length > 0 ? { kind: "missing", missing } : { kind: "current" };
}
