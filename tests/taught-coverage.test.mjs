import { test } from "node:test";
import assert from "node:assert/strict";

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  closingAdvice,
  coverage,
  installedVersions,
  parseResolved,
  taughtPackages,
} from "../scripts/taught-coverage.mjs";

const CLI = fileURLToPath(new URL("../scripts/taught-coverage.mjs", import.meta.url));

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

  // These assertions are about the CORPUS, not about the implementation. The previous version of
  // this test built `installed` from `taught` and asserted `problems.length === taught.size - 1` —
  // which holds for any value `taught` takes, so removing subpath collapse entirely left it green
  // (F-tests-4, the same tautology class as B-008's F-ta-1).
  assert.deepEqual(
    [...taught].sort(),
    [
      "@theokit/di",
      "@theokit/di-agent",
      "@theokit/gateway-discord",
      "@theokit/gateway-slack",
      "@theokit/gateway-telegram",
      "@theokit/sdk",
      "@theokit/sdk-tools",
    ],
    "the corpus taught set changed — update this list deliberately, or the extractor broke",
  );
  // subpaths must collapse to the package: 22 of 29 specifiers in the corpus carry one
  for (const name of taught) {
    assert.equal(name.split("/").length, 2, `${name} kept its subpath — collapse is broken`);
  }

  // `installed` is built from a FIXED list, not from `taught`, so the two cannot move together.
  const installed = new Map([
    ["@theokit/sdk", "4.60.0"],
    ["@theokit/di", "0.2.0"],
    ["@theokit/di-agent", "0.4.0"],
    ["@theokit/gateway-discord", "0.1.5"],
    ["@theokit/gateway-slack", "0.2.2"],
    ["@theokit/gateway-telegram", "0.2.3"],
    ["@theokit/sdk-tools", "0.27.2"],
  ]);
  const resolved = new Map([["@theokit/sdk", "4.60.0"]]);

  const result = coverage(taught, installed, resolved);

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.problems.map((p) => p.name),
    [
      "@theokit/di",
      "@theokit/di-agent",
      "@theokit/gateway-discord",
      "@theokit/gateway-slack",
      "@theokit/gateway-telegram",
      "@theokit/sdk-tools",
    ],
  );
  assert.ok(result.problems.every((p) => p.kind === "not-resolved"));
});


// ── T1.3, from the edge-case analysis that /review Step 6 caught as never having run ──────────────
//
// Both of these are the same mistake in two places: treating a missing input as a clean result.
// `main()` already refused an empty RESOLVED for that reason. The reasoning was applied to one of
// the two inputs, and the test suite guarded what the production path did not.

test("an empty taught set is refused, not passed as clean", () => {
  // If skills/ is empty, unreadable, renamed, or the extractor breaks, the gate would otherwise
  // report success having verified nothing — which is the vacuity this whole item removes.
  const result = coverage(new Set(), new Map(), new Map([["@theokit/sdk", "4.60.0"]]));

  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 1);
  assert.equal(result.problems[0].kind, "empty-corpus");
});

test("a resolved token carrying no version is surfaced, not silently dropped", () => {
  // Dropping it made the package report `not-resolved`, whose remedy is "add it to
  // TAUGHT_PACKAGES" — a confident wrong instruction, since it is already there.
  const resolved = parseResolved("@theokit/sdk @theokit/di@0.2.0 broken@");

  assert.equal(resolved.get("@theokit/di"), "0.2.0");
  assert.deepEqual(resolved.malformed, ["@theokit/sdk", "broken@"]);
  assert.equal(resolved.has("@theokit/sdk"), false);
});

// ── The CLI contract, as two distinct behaviours ─────────────────────────────────────────────────
//
// Found by reading the log of a green run: the workflow's REPORT step was exiting 1 on every single
// run, printing `BOOKKEEPING MISMATCH — RESOLVED is empty` into the output, and `continue-on-error`
// was swallowing it. The job was green and its diagnostic step was erroring every time — the exact
// class of defect this item exists to remove, introduced by the fix for it.
//
// ADR-2 of the plan separates the two steps: one that can never fail, one whose only purpose is to
// fail. That separation existed in the YAML and not in the code, where a single `main()` did both.
// These tests hold the CLI to it, through the real binary rather than a mocked one.

test("without --assert the CLI only reports, and succeeds even with no RESOLVED", () => {
  const run = spawnSync(process.execPath, [CLI], { encoding: "utf8", env: { ...process.env, RESOLVED: "" } });

  assert.equal(run.status, 0, `report-only must not fail; stderr was:\n${run.stderr}`);
  assert.match(run.stdout, /taught-surface-coverage: \d+\/\d+/);
  assert.doesNotMatch(run.stderr, /BOOKKEEPING MISMATCH/);
});

test("with --assert and an empty RESOLVED the CLI refuses rather than reporting clean", () => {
  const run = spawnSync(process.execPath, [CLI, "--assert"], {
    encoding: "utf8",
    env: { ...process.env, RESOLVED: "" },
  });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /BOOKKEEPING MISMATCH/);
  assert.match(run.stderr, /RESOLVED is empty/);
});

test("--assert prints the verdict a human reads, and does not repeat the listing", () => {
  // F-wire-2: the assert step redirected stdout to /dev/null, so the ONLY observable reaching a
  // human was `taught-surface-coverage: N/M ... present in node_modules` — the PRESENCE metric that
  // ADR-3 refutes. The metric visible after the change was the metric the change replaced. Worse,
  // the implementation log quoted the suppressed line as an excerpt of a real run, where it appears
  // zero times. The verdict has to reach stdout for that quote to ever be true.
  const resolved = [...taughtPackages()].map((n) => `${n}@0.0.0-test`).join(" ");
  const run = spawnSync(process.execPath, [CLI, "--assert"], {
    encoding: "utf8",
    env: { ...process.env, RESOLVED: resolved },
  });

  // every taught package is "resolved" at a version nothing on disk has -> shadowed, so it fails
  assert.equal(run.status, 1);
  assert.match(run.stderr, /shadowed|different version/);
  // and the listing is NOT repeated: the report step already printed it
  assert.doesNotMatch(run.stdout, /taught-surface-coverage:/);
});

// ── The I/O boundary, which had no test at all ───────────────────────────────────────────────────
//
// F-tests-2: `installedVersions` is the module's only filesystem + JSON.parse function and nothing
// exercised it. A reviewer measured the consequence: reading `.name` instead of `.version` survives
// every other test, so every package would report `shadowed` with a package NAME where a version
// belongs — the daily job failing with a nonsense diagnosis and the suite green.

test("installedVersions reads the version, from a root it is given", () => {
  const root = mkdtempSync(join(tmpdir(), "taught-coverage-"));
  try {
    const dir = join(root, "node_modules", "@theokit", "sdk");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "@theokit/sdk", version: "9.9.9" }));

    const found = installedVersions(new Set(["@theokit/sdk", "@theokit/absent"]), root);

    assert.equal(found.get("@theokit/sdk"), "9.9.9", "must read version, not name");
    assert.equal(found.has("@theokit/absent"), false, "an absent package is absent, not empty");
    assert.equal(found.size, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the failure names the cause it can act on, and never the wrong one", () => {
  // F-tests-5 / F-xval-4. An empty corpus told the reader to edit TAUGHT_PACKAGES — advice that
  // cannot possibly help, since nothing was measured at all.
  const emptyCorpus = closingAdvice([{ name: "(the skills corpus)", kind: "empty-corpus" }]).join(" ");
  assert.match(emptyCorpus, /Nothing was measured/);
  assert.doesNotMatch(emptyCorpus, /TAUGHT_PACKAGES/);

  const missing = closingAdvice([{ name: "@theokit/di", kind: "not-resolved" }]).join(" ");
  assert.match(missing, /TAUGHT_PACKAGES/);

  const shadowed = closingAdvice([{ name: "@theokit/sdk", kind: "shadowed" }]).join(" ");
  assert.doesNotMatch(shadowed, /TAUGHT_PACKAGES/, "shadowing is not fixed by editing the list");
});

test("the BOOKKEEPING literal reaches stderr — it is the signal T1.2 rests on", () => {
  const run = spawnSync(process.execPath, [CLI, "--assert"], {
    encoding: "utf8",
    env: { ...process.env, RESOLVED: "@theokit/sdk@4.60.0" },
  });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /BOOKKEEPING MISMATCH — this is not API drift\./);
  assert.match(run.stderr, /not in TAUGHT_PACKAGES/);
});
