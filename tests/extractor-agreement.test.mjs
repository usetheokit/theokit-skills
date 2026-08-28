/**
 * The drift gates must agree on what counts as a taught import.
 *
 * `/review` of B-005 found F-arch-1 (HIGH): `no-blind-specifier.test.mjs` copied
 * `api-resolves.test.mjs`'s extractor and dropped its `deprecatedRanges()` exclusion, so the two
 * gates disagreed about whether an import inside a `Don't:` block counts. Two reviewers measured
 * the divergence as LATENT — both saw the same 29 specifiers, because zero deprecated fences exist
 * today.
 *
 * Latent is exactly why this file exists. The skills teach by contrast on purpose, and the day one
 * of them shows an old import of a package nobody installs, the stricter gate goes red over an
 * example the other gate deliberately ignores. The only ways out would be adding a devDependency
 * for a stale example or deleting the counter-example — both worse than the divergence.
 *
 * Run: `npm test` (node --test).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { importsIn, specifiersIn } from "./_skills.mjs";

const testsDir = dirname(fileURLToPath(import.meta.url));

const DEPRECATED = [
  "Don't:",
  "Before:",
  "Old:",
  "❌ Do not:",
  "Instead of:",
];

test("an import inside a deprecated fence is not a taught import", () => {
  for (const marker of DEPRECATED) {
    const text = `${marker}\n\n\`\`\`typescript\nimport { X } from "@theokit/not-installed";\n\`\`\`\n`;
    assert.deepEqual(
      [...specifiersIn(text)],
      [],
      `a block introduced by ${JSON.stringify(marker)} teaches by contrast — its import is not taught`,
    );
  }
});

test("an import outside a deprecated fence IS a taught import", () => {
  // The control. Without it, an extractor that returned nothing would pass the test above while
  // measuring nothing — the shape `api-resolves.test.mjs:20-22` records having been bitten by.
  const text = 'Use this:\n\n```typescript\nimport { X } from "@theokit/sdk";\n```\n';
  assert.deepEqual([...specifiersIn(text)], ["@theokit/sdk"]);
});

test("no test file carries its own import or fence extractor", () => {
  // F-ta-1 (/review of B-008): the test below compares `specifiersIn` against `importsIn`, and
  // `_skills.mjs:84` implements the first by CALLING the second. It compares a wrapper with its own
  // delegate, so it agrees by construction. The reviewer proved it: re-introducing B-005's exact
  // divergence in a scratch worktree left the suite 47/47 green.
  //
  // This is the guard that can actually fail. The divergence B-008 closes was a SECOND extractor,
  // so what has to be asserted is that no second one exists — a structural property, checkable by
  // reading the files rather than by comparing two functions that share an implementation.
  // Two families, because two extractors have diverged in this repository and only one of them was
  // ever guarded. B-008 removed a duplicated IMPORT extractor and this guard was named as what
  // prevents recurrence; `tests/_skills.mjs:63` records that a duplicated FENCE extractor shipped
  // anyway, and the two disagreed on a whitespace-only line. `fencePattern()` unified them — but a
  // fourth copy would pass this guard silently, because it never looked for fences. (F-4, /review.)
  const OWN_EXTRACTOR = [
    /matchAll\(\s*\/(?:[^/\\]|\\.)*import|from\\s\*\[/,
    /\/[^/\n]*(?:`\{3,|~\{3,|```|~~~)/,
  ];

  // Strip QUOTED STRINGS before testing, because a guard that reads fixture data reports the tests
  // that exercise the extractor as if they duplicated it. The fence family flagged three lines of
  // `skills-module.test.mjs` on its first run — all of them fence literals inside test inputs, none
  // of them an extractor. Caught by reading the three, not by trusting the count.
  //
  // Template literals are deliberately NOT stripped: `fencePattern()` writes its fence runs as
  // ``` `{3,} ``` INSIDE a regex literal, and a backtick-to-backtick strip would eat exactly the
  // thing being detected — the guard would go quiet on the one extractor it exists to find.
  //
  // A comment-only line is dropped whole. `//` supplies the slash the fence family looks for, so
  // every paragraph in this repository that DESCRIBES the truncation bug — and they are the reason
  // the fixes are legible — read as an extractor. Prose about a regex is not a regex.
  const codeOnly = (line) =>
    /^[ \t]*\/\//.test(line) ? "" : line.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '""');
  const MARKER_WINDOW = 6;
  const offenders = [];
  // Recursive. The first version listed `testsDir` only, so `tests/lint/no-ptbr.test.mjs` — a test
  // file inside this guard's own declared scope — was never read. A guard that silently excludes
  // part of what it claims to cover reports absence where it never looked. (F-dt-2, /review of B-010.)
  // `suffix` differs by tree: under `tests/` only test files can carry an extractor, but under
  // `scripts/` nothing is a test — filtering on `.test.mjs` there scanned zero files and the
  // widening did nothing. Caught by the control: a planted extractor in `scripts/` was not reported.
  const walk = (dir, suffix, prefix = "") => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), suffix, rel);
        continue;
      }
      if (!entry.name.endsWith(suffix)) continue;
      // The agreement test itself names the pattern in prose and in this regex; skip only itself.
      if (rel === "extractor-agreement.test.mjs") continue;
      const lines = readFileSync(join(dir, entry.name), "utf8").split("\n");
      // One legitimate exception, declared NEXT TO the extractor rather than anywhere in the file: a
      // test that proves a widening is ADDITIVE has to count independently, because verifying a
      // reader with itself is the tautology B-008 removed. The marker makes the exception greppable
      // and visible in a diff — the same shape as `ADR-DISMISS-SOFT-CAP` and `zizmor: ignore`
      // elsewhere here. A silent skip would let any violation wear the same excuse.
      //
      // The scope is the point, and it was wrong: the check read the WHOLE file, so one marker
      // excused every extractor in it, while the paragraph above claimed the exception had to be
      // declared on the line. `skills-module.test.mjs` already carries a marker and is exactly where
      // future additive proofs accumulate — the next one would have inherited an excuse nobody
      // wrote. Honest about WHY and dishonest about WHERE is still a gate that does not hold.
      // (F-3, /review.) The window is small and above, because a marker explains what follows it.
      for (const [n, line] of lines.entries()) {
        const code = codeOnly(line);
        if (!OWN_EXTRACTOR.some((p) => p.test(code))) continue;
        if (lines.slice(Math.max(0, n - MARKER_WINDOW), n + 1).some((l) => /extractor-oracle:/.test(l))) continue;
        offenders.push(`${rel}:${n + 1}`);
      }
    }
  };
  // `tests/` AND `scripts/`. B-003 created `scripts/taught-coverage.mjs`, the first corpus reader
  // outside this tree — and cited THIS guard as the reason not to duplicate the extractor, while
  // placing a consumer where the guard cannot see it. It happens to use the shared module; the guard
  // is what makes that a guarantee instead of a habit. (B-016.)
  walk(testsDir, ".test.mjs");
  walk(join(testsDir, "..", "scripts"), ".mjs", "scripts");
  assert.deepEqual(
    offenders,
    [],
    `these test files parse the corpus themselves instead of using _skills.mjs: ${offenders.join(", ")}`,
  );
});

test("both extractors read the same taught imports from the same text", () => {
  const text = [
    'Use this:\n\n```typescript\nimport { A } from "@theokit/sdk";\n```',
    "Before:\n\n```typescript\nimport { B } from \"@theokit/gone\";\n```",
    'And also:\n\n```typescript\nimport { C } from "@theokit/sdk/errors";\n```',
  ].join("\n\n");

  const fromSpecifiers = [...specifiersIn(text)].sort();
  const fromImports = [...new Set(importsIn(text).map((i) => i.specifier))].sort();

  assert.deepEqual(fromSpecifiers, fromImports, "the two gates must not disagree about the corpus");
  assert.ok(fromSpecifiers.length > 0, "both extractors returned nothing — they agree vacuously");
  assert.ok(!fromSpecifiers.includes("@theokit/gone"), "the deprecated import leaked through");
});
