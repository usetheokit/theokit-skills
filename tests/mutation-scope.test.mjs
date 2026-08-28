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
    // Three forms, because this repository already uses all three and a detector that knows two of
    // them fails in the silent direction:
    //   1. `from "../lib/x.mjs"`      — a direct import
    //   2. `new URL("../bin/x.mjs")`  — how `taught-coverage.test.mjs` locates a CLI to spawn
    //   3. `join(root, "bin", "x")`   — how `cli.test.mjs` does, and no path-string regex sees it
    //
    // (1) and (2) are both just "a string containing `lib/` or `bin/`", which over-matches prose.
    // That asymmetry is deliberate: a false positive costs one line in `test:mutation` or one
    // sentence of explanation, and a false negative is a mutation score that silently measures less
    // than it claims. Measured on the current suite: zero false positives.
    //
    // Comment-only lines are dropped first, and that is NOT a softening of the asymmetry above.
    // Nothing is ever imported from a comment, so the false-NEGATIVE direction is untouched; what
    // it removes is prose. `drift-workflow.test.mjs` cites `lib/manifest.mjs` as the first of four
    // instances of one Windows path bug — a historical precedent, in backticks, which this
    // detector's own `["\'`]` class reads as a quoted path. The prescribed remedy ("one line in
    // `test:mutation`") would have put a test that cannot kill a single lib/ mutant into the
    // mutation run, slowing every future audit for a fictional reason. A gate reading PROSE ABOUT
    // a file as a dependency on it is the same defect `tests/extractor-agreement.test.mjs` fixed
    // the same day, where `//` supplied the slash a fence pattern was looking for.
    const code = text.split("\n").filter((l) => !/^[ \t]*\/\//.test(l)).join("\n");
    const pathLiteral = /["'`][^"'`]*(?:\.\.\/)?(?:lib|bin)\/[^"'`]*["'`]/;
    const segments = /join\([^)]*["'`](?:bin|lib)["'`]/;
    if (pathLiteral.test(code) || segments.test(code)) exercises.push(file);
  }

  assert.ok(exercises.length > 0, "no test exercises lib/ or bin/ — the detector is broken, not the suite");
  const missing = exercises.filter((f) => !script.includes(f));
  assert.deepEqual(
    missing,
    [],
    `these tests can kill mutants and are not in \`test:mutation\`, so the score would silently drop: ${missing.join(", ")}`,
  );
});
