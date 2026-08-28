// The scheduled drift job is the only workflow here with no `pull_request` trigger, so a change to
// it first executes at 06:00 UTC against the real registry. Two defects landed in it in one day and
// CI caught neither; both were found by a human dispatching it, which needs repository admin.
//
// This file is the reviewable path. It reads the workflow as TEXT — no YAML parser, because this
// repository has zero runtime dependencies and the invariants at stake are the literal shape of
// three `if:` expressions (ADR-2 of the plan). It runs through `npm test`, which `ci.yml` runs on
// every pull request, so a change to the job is exercised before it merges without admin and
// without touching the registry.
//
// What it CANNOT do is execute the job. Stated here rather than implied: it stops the pin that was
// undone once from being undone again, and it stops a failure mode from going unreported. It does
// not prove the job works.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WORKFLOW = join(dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows", "sdk-drift.yml");

// EC-1: every "this pattern is absent" assertion below PASSES over an empty string, and half of
// them are of that kind. A wrong path would report a clean bill of health. Read once, prove it is
// really there, and let every other test build on that.
const text = readFileSync(WORKFLOW, "utf8");

test("the workflow file is really the workflow", () => {
  assert.ok(text.length > 1000, "sdk-drift.yml is missing or truncated");
  assert.match(text, /^name: sdk-drift$/m);
  // EC-6: "no uncovered failure mode" is trivially true of a job with no steps. A floor makes the
  // absence of steps a failure rather than a pass.
  const steps = [...text.matchAll(/^      - (?:name|uses):/gm)].length;
  assert.ok(steps >= 6, `expected the job to still have its steps, found ${steps}`);
});

test("every way this job can fail reaches an issue step", () => {
  // EC-2: asserting each condition separately proves nothing about their relationship. The
  // invariant is over the PAIR — no failure lands in neither, none lands in both. So both are
  // extracted and compared, rather than matched one at a time.
  const conditions = [...text.matchAll(/^        if: failure\(\) && (.+)$/gm)].map((m) => m[1].trim());

  assert.equal(
    conditions.length,
    2,
    `expected exactly two failure-triggered alert steps, found ${conditions.length}: ${JSON.stringify(conditions)}`,
  );

  // EC-3: `steps.check.outcome` is `skipped` when the step is skipped, and unset when the job never
  // reached it (a failure in checkout or setup-node). `!=` is true in both; `== 'skipped'` would
  // silently miss the second, which is the wider of the two.
  const sorted = [...conditions].sort();
  assert.deepEqual(sorted, [
    "steps.check.outcome != 'failure'",
    "steps.check.outcome == 'failure'",
  ].sort(), "the two alert conditions must partition failure() — one for drift, one for everything else");
});

test("a run that could not check is distinguishable from a run that found drift", () => {
  // EC-5: the titles are the dedup keys, searched with `in:title`. Equality is not enough — if one
  // title contains the other, an open "could not run" issue swallows a real drift filed the same
  // day. That is F-dom-7 of the B-004 review repeating: the alert lost, not mislabelled.
  const titles = [...text.matchAll(/^          title="([^"]+)"$/gm)].map((m) => m[1]);
  assert.equal(titles.length, 2, `expected two issue titles, found ${JSON.stringify(titles)}`);

  // Strip the trailing parenthetical, not just the `$(...)` inside it. Stripping only the
  // substitution leaves an empty `()` behind, and that stray pair breaks the very substring
  // relation being tested: with the date gone but the parens kept, "…package ()" is not a substring
  // of "…package could not run ()". The control caught it — a deliberately colliding pair of titles
  // produced zero failures.
  const [a, b] = titles.map((t) => t.replace(/\s*\(.*\)\s*$/, "").trim());
  assert.ok(!a.includes(b) && !b.includes(a), `titles collide through in:title search: ${a} / ${b}`);
});

test("typescript is pinned from the lockfile, never resolved from the registry", () => {
  // EC-4, and this is the assertion that would have shipped wrong. The COMMENT above the pin
  // contains the exact string a naive search looks for — it explains the bug — so grepping the file
  // for `npm view typescript` fails on the correct tree and passes on nothing. Target the
  // resolution line itself, which is the only place the value is produced.
  const line = text.split("\n").find((l) => !l.trim().startsWith("#") && l.includes("typescript@$("));
  assert.ok(line, "the typescript pin is gone");

  assert.match(line, /package-lock\.json/, "typescript must come from the lockfile");
  assert.doesNotMatch(
    line,
    /npm view/,
    "run 33126449378: `npm view typescript version` resolves 7.x, whose JS API has no ts.ScriptTarget",
  );
});

test("the coverage report cannot fail the job", () => {
  // ADR-2 of the B-004 plan, found as F-arch-2: this step used to sit BEFORE `check`, so a crash in
  // the REPORT silenced the ALERT. The order is the fix; `continue-on-error` plus `always()` is what
  // makes it true rather than intended.
  const report = text.slice(text.indexOf("- name: Report taught-surface-coverage"));
  const body = report.slice(0, report.indexOf("      - name:", 10));
  assert.match(body, /^        if: always\(\)$/m);
  assert.match(body, /^        continue-on-error: true$/m);
});
