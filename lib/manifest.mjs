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

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MANIFEST_NAME = ".theokit-skills.json";

/** Schema version. A bump means "wipe and reinstall", never "silently migrate". */
const SCHEMA = 2;

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
 * Reports four distinct states rather than a boolean, because the fixes differ: never installed,
 * installed from a different version, installed but the files are gone, or installed and the
 * content changed underneath.
 *
 * `expected` is NOT a parameter. It used to be, and the caller passed the INSTALLATION PLAN — what
 * an install would do now, derived from which tools are detected on this machine. So a bare
 * `--check` after a `--target=agents` install reported DRIFT on any machine that also had
 * `~/.claude`, for paths that were never installed. Measured at 55d64ca: exit 1 against a correct
 * install. The manifest already records what WAS installed, target and all; that is the only
 * honest expectation.
 */
export function drift(projectRoot, { version }) {
  const manifest = readManifest(projectRoot);
  if (manifest === undefined) return { kind: "absent" };
  if (manifest.version !== version) {
    return { kind: "version", installed: manifest.version, current: version };
  }

  // Existence BEFORE content, and the order is load-bearing: hashing an absent path — or a link
  // whose target is gone, which `npm ci` leaves behind — throws ENOENT. A crash is not a drift
  // report. Measured before writing this.
  const missing = manifest.entries
    .filter((e) => !existsSync(join(projectRoot, e.path)))
    .map((e) => e.path);
  if (missing.length > 0) return { kind: "missing", missing };

  const changed = manifest.entries
    .filter((e) => e.digest !== digestOf(join(projectRoot, e.path)))
    .map((e) => e.path);
  return changed.length > 0 ? { kind: "content", changed } : { kind: "current" };
}

/**
 * A digest over a skill DIRECTORY — every file's relative path and content, in a stable order.
 *
 * The directory rather than `SKILL.md`, because content is meant to live beside it: a file under
 * `references/` moves this digest exactly as the instruction file does, which is what B-002's third
 * criterion asks for and what no second mechanism now has to provide.
 *
 * Measured, so nobody adds a special case that is not needed: a directory symlink (install mode
 * `link`) hashes identically to its target, because `readdirSync` follows it. Both shipped modes
 * work with no branch here.
 */
export function digestOf(dir) {
  const hash = createHash("sha256");
  const walk = (current, prefix) => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(current, entry.name);
      // `statSync` follows: a symlink to a directory is walked, a symlink to a file is read. The
      // Dirent's own `isDirectory()` does not follow, and would send a linked directory to
      // `readFileSync` as EISDIR.
      if (statSync(path).isDirectory()) {
        walk(path, rel);
        continue;
      }
      hash.update(rel);
      hash.update(readFileSync(path));
    }
  };
  walk(dir, "");
  return hash.digest("hex");
}
