// Placing one skill directory at a destination, on Windows, macOS and Linux.
//
// TWO DECISIONS, AND THE FIRST ONE IS THE ONE PEOPLE GET WRONG.
//
// 1. LINK OR COPY — decided by whether the source will still be there tomorrow.
//
//    A link is the better artifact: it makes the installed skill follow the lockfile, so
//    `npm update @theokit/skills` updates the instructions instead of leaving a year-old copy
//    that the agent obeys with the same diligence as a current one. But a link is only valid if
//    the target path is stable. Run through `npx`, this package lives in a temporary npm cache
//    directory that is pruned; a link into it is a link into nothing, and the failure is silent —
//    the agent simply finds no skill.
//
//    So: link when this package sits inside the destination project's `node_modules`, copy
//    otherwise. That is the honest reading of "can I still resolve this next week?".
//
// 2. HOW TO LINK — decided by the platform, and `junction` is the point.
//
//    On Windows, `fs.symlink` needs SeCreateSymbolicLinkPrivilege: Administrator, or Developer
//    Mode. Anthropic's own docs tell readers to avoid symlinks there for exactly this reason. A
//    JUNCTION needs no elevation at all. It is restricted to directories and requires an absolute
//    target — both fine here, because a skill IS a directory. Off Windows, a RELATIVE symlink is
//    better: it survives the tree being moved or renamed.
//
//    Every failure path falls back to copying, and the caller is told which mode it got. A silent
//    downgrade would make "installed" mean two different things with no way to tell them apart.

import { cpSync, existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { platform } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";

/** @typedef {"link" | "copy"} InstallMode */

/**
 * Would a link from `packageRoot` still resolve after this process exits?
 *
 * True only when the package is a real dependency of the project being installed into. The npx
 * cache, a global install and a tarball unpacked in /tmp all answer false — correctly.
 *
 * Exported for the tests: the answer is pure path arithmetic, and it is worth pinning.
 */
export function isStableSource(packageRoot, projectRoot) {
  const modules = resolve(projectRoot, "node_modules") + sep;
  return resolve(packageRoot).startsWith(modules);
}

/** The link a caller should create for `target`, given the platform. */
export function linkSpec(target, linkPath, os = platform()) {
  if (os === "win32") {
    // Junctions take an absolute target and need no elevated privilege.
    return { type: "junction", target: resolve(target) };
  }
  // A relative target keeps working if the whole tree is moved.
  return { type: undefined, target: relative(dirname(resolve(linkPath)), resolve(target)) };
}

/** Is `linkPath` already a link pointing at `target`? Then there is nothing to do. */
function alreadyLinked(linkPath, target) {
  try {
    if (!lstatSync(linkPath).isSymbolicLink()) return false;
    return resolve(dirname(linkPath), readlinkSync(linkPath)) === resolve(target);
  } catch {
    return false;
  }
}

/**
 * Put the skill at `source` into `dest`, linking when `preferLink`, copying otherwise or on any
 * failure.
 *
 * @returns {{ mode: InstallMode, changed: boolean, linkFailed: boolean }}
 */
export function place(source, dest, { preferLink, force = false } = {}) {
  mkdirSync(dirname(dest), { recursive: true });

  if (preferLink && alreadyLinked(dest, source)) {
    return { mode: "link", changed: false, linkFailed: false };
  }

  const exists = existsSync(dest) || isDanglingLink(dest);
  if (exists && !force) {
    return { mode: currentMode(dest), changed: false, linkFailed: false };
  }
  if (exists) rmSync(dest, { recursive: true, force: true });

  if (preferLink) {
    try {
      const spec = linkSpec(source, dest);
      symlinkSync(spec.target, dest, spec.type);
      return { mode: "link", changed: true, linkFailed: false };
    } catch {
      // Fall through to copy. Windows without Developer Mode, a filesystem that refuses links,
      // a container with restricted capabilities — all land here, and all still get a skill.
      cpSync(source, dest, { recursive: true });
      return { mode: "copy", changed: true, linkFailed: true };
    }
  }

  cpSync(source, dest, { recursive: true });
  return { mode: "copy", changed: true, linkFailed: false };
}

/** A link whose target is gone still occupies the path — `existsSync` follows links and says no. */
function isDanglingLink(path) {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** How the thing currently at `path` was installed. */
export function currentMode(path) {
  try {
    return lstatSync(path).isSymbolicLink() ? "link" : "copy";
  } catch {
    return "copy";
  }
}
