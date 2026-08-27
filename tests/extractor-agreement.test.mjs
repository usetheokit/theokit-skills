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
import { test } from "node:test";

import { importsIn, specifiersIn } from "./_skills.mjs";

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
