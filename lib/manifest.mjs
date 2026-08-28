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

/**
 * Entries this run installed, plus the ones a previous run installed into OTHER targets.
 *
 * This used to replace. Since `drift()` reads the manifest as its sole expectation, replacing meant
 * an earlier target silently left the gate: install for `agents`, then for `claude`, and the 31
 * `.agents/skills` directories stayed on disk while `--check` reported `up to date — 31`. The count
 * was true of the manifest and false of the tree — a gate claiming coverage it does not have, which
 * is the one thing `agents/theokit-skills.md` forbids outright. Reproduced before this was written.
 *
 * A VERSION change still replaces wholesale: entries from another version describe a layout this
 * one may not produce, and the schema's contract for that case is already wipe-and-reinstall.
 *
 * Consequence worth stating: an entry whose target is never re-installed stays until its path is
 * gone, at which point `--check` reports it `missing`. That is a real signal — something was
 * installed and is not there — and it is louder than the silence it replaces.
 */
function mergeEntries(projectRoot, version, entries) {
  const previous = readManifest(projectRoot);
  if (previous === undefined || previous.version !== version) return [...entries];

  const replaced = new Set(entries.map((e) => `${e.target}\u0000${e.skill}`));
  const kept = previous.entries.filter((e) => !replaced.has(`${e.target}\u0000${e.skill}`));
  return [...kept, ...entries];
}

export function writeManifest(projectRoot, { version, entries }) {
  const body = {
    schema: SCHEMA,
    package: "@theokit/skills",
    version,
    // Sorted so the file is stable across runs and diffs stay readable.
    entries: mergeEntries(projectRoot, version, entries).sort((a, b) =>
      `${a.skill}${a.target}`.localeCompare(`${b.skill}${b.target}`),
    ),
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
    .filter((e) => !existsSync(entryPath(projectRoot, e)))
    .map((e) => e.path);
  if (missing.length > 0) return { kind: "missing", missing };

  const changed = manifest.entries
    .filter((e) => e.digest !== digestOf(entryPath(projectRoot, e)))
    .map((e) => e.path);
  return changed.length > 0 ? { kind: "content", changed } : { kind: "current" };
}

/**
 * Resolve a manifest entry's path, whatever separator wrote it.
 *
 * `relative()` returns backslashes on Windows, and POSIX `join` treats them as part of a filename —
 * so a manifest committed from a Windows checkout reported EVERY entry `missing` on a Linux runner.
 * The module header calls this file "meant to be committed alongside the skills it describes", so
 * reading it on another OS is the intended use rather than an edge. (W-05, /review.)
 */
function entryPath(projectRoot, entry) {
  return join(projectRoot, ...String(entry.path).split(/[\\/]/).filter(Boolean));
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
      //
      // It is also the first thing that throws on a dangling child link — before `readFileSync`
      // ever runs — so the guard belongs here, not only around the read. (W-04, /review.)
      let isDirectory;
      try {
        isDirectory = statSync(path).isDirectory();
      } catch (error) {
        hash.update(rel);
        hash.update(`<unstattable:${error.code ?? "ERR"}>`);
        continue;
      }
      if (isDirectory) {
        walk(path, rel);
        continue;
      }
      hash.update(rel);
      // An unreadable child is hashed as its error, not thrown. `digestOf` runs at INSTALL time,
      // inside the argument to `writeManifest` — a throw there happens after every skill is placed
      // and before any manifest is written, leaving skills on disk that `--check` then calls "never
      // installed here". A file that cannot be read is a real state of the tree, and it changes the
      // digest, which is exactly what the caller needs to know. (W-04, /review.)
      try {
        hash.update(readFileSync(path));
      } catch (error) {
        hash.update(`<unreadable:${error.code ?? "ERR"}>`);
      }
    }
  };
  walk(dir, "");
  return hash.digest("hex");
}
