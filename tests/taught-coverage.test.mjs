import { test } from "node:test";
import assert from "node:assert/strict";

import { coverage, parseResolved, taughtPackages } from "../scripts/taught-coverage.mjs";

// B-010. The drift job printed `taught-surface-coverage: 7/7` and nothing read it — and the number
// itself was vacuous: dispatched run 33128039399 shrank TAUGHT_PACKAGES to one package and still
// printed 7/7, because `npm install --no-save <pkg>` installs package.json's dependencies too and
// all seven taught packages are devDependencies. Six arrived from the lockfile, at versions that by
// construction cannot have moved.
//
// So the question is not "is the package there" but "is the package there at the version THIS RUN
// resolved from the registry". These tests are written against that question.

test("a taught package this run never resolved is reported, even though it is on disk", () => {
  const taught = new Set(["@theokit/sdk", "@theokit/di"]);
  const resolved = new Map([["@theokit/sdk", "4.60.0"]]);
  const installed = new Map([
    ["@theokit/sdk", "4.60.0"],
    ["@theokit/di", "0.2.0"], // present — from the lockfile, which is the whole point
  ]);

  const result = coverage(taught, installed, resolved);

  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].name, "@theokit/di");
  assert.equal(result.problems[0].kind, "not-resolved");
});

test("a resolved package missing from disk is reported as not installed", () => {
  const taught = new Set(["@theokit/sdk"]);
  const resolved = new Map([["@theokit/sdk", "4.60.0"]]);

  const result = coverage(taught, new Map(), resolved);

  assert.equal(result.ok, false);
  assert.equal(result.problems[0].kind, "not-installed");
  assert.equal(result.problems[0].want, "4.60.0");
});

test("a lockfile version shadowing the resolved one is reported as shadowed", () => {
  // The exact shape observed in run 33128039399: sdk-tools present at its lockfile version while a
  // newer one was published. Named, present, and a release stale.
  const taught = new Set(["@theokit/sdk-tools"]);
  const resolved = new Map([["@theokit/sdk-tools", "0.27.2"]]);
  const installed = new Map([["@theokit/sdk-tools", "0.27.0"]]);

  const result = coverage(taught, installed, resolved);

  assert.equal(result.ok, false);
  assert.equal(result.problems[0].kind, "shadowed");
  assert.equal(result.problems[0].want, "0.27.2");
  assert.equal(result.problems[0].onDisk, "0.27.0");
});

test("agreement across the three sets is ok, parsing a real resolved line", () => {
  // Also covers parseResolved against scoped names, where the version separator is the LAST `@`.
  const resolved = parseResolved(
    "@theokit/sdk@4.60.0 @theokit/gateway-slack@0.2.2 typescript@5.9.3",
  );
  assert.equal(resolved.get("@theokit/sdk"), "4.60.0");
  assert.equal(resolved.get("@theokit/gateway-slack"), "0.2.2");

  const taught = new Set(["@theokit/sdk", "@theokit/gateway-slack"]);
  const installed = new Map([
    ["@theokit/sdk", "4.60.0"],
    ["@theokit/gateway-slack", "0.2.2"],
  ]);

  const result = coverage(taught, installed, resolved);

  assert.equal(result.ok, true);
  assert.deepEqual(result.problems, []);
});

// B-010's named regression, in the item's own words: a reviewer asked whether the report would
// notice someone REVERTING the widening. The first implementation did not, and this is the test
// that fails against it.
test("reverting the install list to a single package is caught, against the real corpus", () => {
  const taught = taughtPackages();
  assert.ok(
    taught.size >= 7,
    `the corpus teaches ${taught.size} packages — under 7 means the extractor broke, not the corpus`,
  );

  const resolved = new Map([["@theokit/sdk", "4.60.0"]]);
  // every taught package present on disk, exactly as the dispatched run observed
  const installed = new Map([...taught].map((n) => [n, n === "@theokit/sdk" ? "4.60.0" : "0.0.1"]));

  const result = coverage(taught, installed, resolved);

  assert.equal(result.ok, false);
  assert.equal(result.problems.length, taught.size - 1);
  assert.ok(result.problems.every((p) => p.kind === "not-resolved"));
  assert.ok(result.problems.some((p) => p.name === "@theokit/gateway-slack"));
});
