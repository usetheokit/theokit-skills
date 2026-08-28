import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Stryker mutates `lib/**` and `bin/**`, and its `command` runner re-runs a whole npm script for
 * EVERY mutant. Measured 2026-08-28: the full suite takes 36.0s and the four files that touch those
 * directories take 5.6s — so 84% of every mutation run was spent on tests that cannot kill a single
 * mutant in the mutated scope, because they exercise the skills corpus instead of the installer.
 * Pointing the runner at the smaller script took the projected run from ~78 minutes back under
 * fifteen.
 *
 * That is only honest while the smaller script still contains every test that CAN kill a mutant. A
 * new test for `lib/` that nobody adds to `test:mutation` does not fail — it silently lowers the
 * score, and the number then measures the script rather than the suite. This is the guard.
 */
test("every test that exercises lib/ or bin/ is in the mutation script", () => {
  const script = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts["test:mutation"];
  assert.ok(script, "package.json has no `test:mutation` script");

  const exercises = [];
  for (const file of readdirSync(join(root, "tests"))) {
    if (!file.endsWith(".test.mjs")) continue;
    // This file names the detector's own patterns in its own regex, so it matches itself. Skipping
    // only itself is what `extractor-agreement.test.mjs` does for the same reason.
    if (file === "mutation-scope.test.mjs") continue;
    const text = readFileSync(join(root, "tests", file), "utf8");
    // by import, or by spawning the binary — `cli.test.mjs` does the second and no grep for
    // `from "../bin/…"` would have seen it.
    if (/from "\.\.\/(lib|bin)\//.test(text) || /join\([^)]*"(bin|lib)"/.test(text)) {
      exercises.push(file);
    }
  }

  assert.ok(exercises.length > 0, "no test exercises lib/ or bin/ — the detector is broken, not the suite");
  const missing = exercises.filter((f) => !script.includes(f));
  assert.deepEqual(
    missing,
    [],
    `these tests can kill mutants and are not in \`test:mutation\`, so the score would silently drop: ${missing.join(", ")}`,
  );
});
