import { test } from "node:test";
import assert from "node:assert/strict";

import { coverage, taughtPackages } from "../scripts/taught-coverage.mjs";

// The drift job prints `taught-surface-coverage: N/M` and does nothing with it. B-010 is the gap
// between printing and asserting: shrinking TAUGHT_PACKAGES back to one package prints `1/7` into a
// log nobody reads while every gate stays green. These tests exercise the comparison directly, so
// the assertion can be shown to fire before it is wired into YAML — where nothing can test it.

test("a package the skills teach and the install misses is named, not just counted", () => {
  const taught = new Set(["@theokit/sdk", "@theokit/di", "@theokit/absent"]);
  const installed = new Map([
    ["@theokit/sdk", "4.60.0"],
    ["@theokit/di", "0.2.0"],
  ]);

  const result = coverage(taught, installed);

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["@theokit/absent"]);
  assert.equal(result.taught, 3);
  assert.equal(result.installed, 2);
});

test("agreement between the two sets is ok, with nothing missing", () => {
  const taught = new Set(["@theokit/sdk", "@theokit/di"]);
  const installed = new Map([
    ["@theokit/sdk", "4.60.0"],
    ["@theokit/di", "0.2.0"],
  ]);

  const result = coverage(taught, installed);

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

// B-010's named regression, in the words the item used: a reviewer asked whether the report notices
// if someone REVERTS the widening. It did not. This is that scenario against the real corpus — if
// the taught set is read from the skills and only @theokit/sdk is installed, every other taught
// package must be named.
test("reverting the install list to a single package is caught, against the real corpus", () => {
  const taught = taughtPackages();
  assert.ok(
    taught.size >= 7,
    `the corpus teaches ${taught.size} packages — under 7 means the extractor broke, not the corpus`,
  );

  const installed = new Map([["@theokit/sdk", "4.60.0"]]);
  const result = coverage(taught, installed);

  assert.equal(result.ok, false);
  assert.equal(result.missing.length, taught.size - 1);
  assert.ok(result.missing.includes("@theokit/gateway-slack"));
  assert.ok(!result.missing.includes("@theokit/sdk"));
});
