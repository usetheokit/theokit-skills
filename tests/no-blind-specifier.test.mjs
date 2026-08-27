/**
 * Every `@theokit` specifier a skill imports must be resolvable by the drift gate.
 *
 * The sibling `api-resolves.test.mjs` RESOLVES the symbols of every specifier it can reach, and
 * reports the ones it cannot as `not checked (not installed here)` — honest about the gap, and
 * unable to fail on it. That report is a line of stdout: it goes amber forever and nothing turns
 * red. This test is the assertion behind it.
 *
 * The extractor lives in `_skills.mjs` since B-008: this file used to carry its own copy without
 * the deprecated-fence exclusion, and the two gates disagreed about what a taught import is.
 *
 * WHY THE FIRST ASSERTION EXISTS. If `importsIn()` ever stops matching — a regex change, a
 * Markdown reformat, a renamed directory — it returns nothing, `unchecked` is empty, and asserting
 * only on `unchecked` would PASS while nothing was examined. A green suite would then mean "no
 * import was checked" and read as "every import is checked". The sibling carries the same guard
 * twice (`api-resolves.test.mjs:115` and `:129`); this is the third.
 *
 * Run: `npm test` (node --test).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { readSkill, skillFiles, specifiersIn } from "./_skills.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/** A specifier is reachable when its package is installed AND declares the subpath in `exports`. */
function isResolvable(specifier) {
  const [scope, name, ...rest] = specifier.split("/");
  const pkg = `${scope}/${name}`;
  const manifest = join(root, "node_modules", scope, name, "package.json");
  if (!existsSync(manifest)) return false;
  const meta = JSON.parse(readFileSync(manifest, "utf8"));
  const sub = rest.length === 0 ? "." : `./${rest.join("/")}`;
  const cond = (meta.exports ?? {})[sub];
  const types = cond?.import?.types ?? cond?.types;
  return typeof types === "string" && existsSync(join(root, "node_modules", scope, name, types));
}

test("no @theokit specifier a skill imports is left unchecked by the drift gate", () => {
  const imported = new Set();
  for (const file of skillFiles()) {
    for (const s of specifiersIn(readSkill(file))) imported.add(s);
  }

  assert.ok(
    imported.size > 0,
    "no @theokit specifier was found in any skill — the extractor is broken, not the manifest",
  );

  const unchecked = [...imported].filter((s) => !isResolvable(s)).sort();
  assert.deepEqual(
    unchecked,
    [],
    `these specifiers are imported by a skill and cannot be resolved: ${unchecked.join(", ")}`,
  );
});
