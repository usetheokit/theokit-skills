import { test } from "node:test";
import assert from "node:assert/strict";

import { importsIn, liveTypescriptBlocks, skillFiles, readSkill, specifiersIn, unterminatedFences } from "./_skills.mjs";

// B-017 and B-024. Both are LATENT — measured across all 31 skills: 90 braced imports, and zero
// default, namespace or re-export forms; zero indented, tilde or four-backtick fences. Built anyway
// because these feed gates, and a dropped form makes a gate report GREEN over something it never
// looked at. ADR-1 of the plan argues that case; the numbers are here so nobody mistakes it for a
// present bug.

// ── B-017: import forms ──────────────────────────────────────────────────────────────────────────

test("a default import is a taught import", () => {
  const found = [...importsIn('import theokit from "@theokit/sdk";\n')];
  assert.deepEqual(found.map((i) => i.specifier), ["@theokit/sdk"]);
});

test("a namespace import is a taught import", () => {
  const found = [...importsIn('import * as sdk from "@theokit/sdk/agent";\n')];
  assert.deepEqual(found.map((i) => i.specifier), ["@theokit/sdk/agent"]);
});

test("a re-export is a taught import", () => {
  const found = [...importsIn('export { Agent } from "@theokit/sdk";\n')];
  assert.deepEqual(found.map((i) => i.specifier), ["@theokit/sdk"]);
});

test("prose that says `import them from` is NOT a taught import", () => {
  // EC-3. My own counting probe reported a phantom default import in the corpus; it was this exact
  // sentence. A loosely widened matcher repeats the mistake, and a phantom taught symbol fails a
  // gate against a package that never exported it.
  const prose = "Do NOT import them from `@theokit/sdk/internal/persistence` (semver-exempt).\n";

  assert.deepEqual([...importsIn(prose)], []);
});

test("the corpus still yields 29 specifiers and 90 braced imports — the change is additive", () => {
  let specifiers = new Set();
  let braced = 0;
  for (const file of skillFiles()) {
    const text = readSkill(file);
    for (const s of specifiersIn(text)) specifiers.add(s);
    // extractor-oracle: counted independently ON PURPOSE. Proving a widening is additive requires a
    // second opinion — checking `importsIn` with `importsIn` is the tautology B-008 spent a cycle
    // removing. Declared for the guard rather than hidden from it.
    braced += [...text.matchAll(/import\s*\{[^}]*\}\s*from\s*["']@theokit/g)].length;
  }

  assert.equal(specifiers.size, 29, "widening must not change what the corpus teaches today");
  assert.equal(braced, 90);
});

// ── B-024: fence forms ───────────────────────────────────────────────────────────────────────────

test("an indented typescript fence is a live block", () => {
  const text = "- item:\n  ```typescript\n  const a = 1;\n  ```\n";
  assert.equal(liveTypescriptBlocks(text).length, 1);
});

test("a tilde fence is a live block", () => {
  assert.equal(liveTypescriptBlocks("~~~typescript\nconst a = 1;\n~~~\n").length, 1);
});

test("a four-backtick fence keeps its WHOLE body", () => {
  // EC-1, and the opposite of what B-024 said. This form is not DROPPED — it matches as three
  // backticks plus a stray one, closes at the INNER ``` and is silently TRUNCATED, so the gate
  // compiles half an example and calls the skill compiling. Four backticks exist precisely to wrap
  // examples containing backticks, which is exactly when the truncation goes unnoticed.
  const blocks = liveTypescriptBlocks("````typescript\nconst a = 1;\n```\nconst b = 2;\n````\n");

  assert.equal(blocks.length, 1);
  assert.match(blocks[0].code, /const b = 2;/, "the body after the inner fence must survive");
});

test("a deprecation marker still excludes each of the new forms", () => {
  for (const [name, body] of [
    // The marker must be the line IMMEDIATELY before the fence — `deprecatedRanges` checks the last
    // non-blank line by design, because an earlier version matched the word anywhere above and hid a
    // real finding behind an ordinary sentence containing "before". A first fixture here put
    // `- item:` between the two and failed for that reason: the fixture was wrong, not the code.
    ["indented", "  ```typescript\n  const a = 1;\n  ```\n"],
    ["tilde", "~~~typescript\nconst a = 1;\n~~~\n"],
    ["four-backtick", "````typescript\nconst a = 1;\n````\n"],
  ]) {
    assert.equal(
      liveTypescriptBlocks(`❌ Do not:\n\n${body}`).length,
      0,
      `${name}: an anti-example must not be compiled, whatever fence it uses`,
    );
  }
});

test("the allowlisted skills still yield 4, 5 and 4 blocks — the change is additive", () => {
  const count = (slug) => {
    const file = skillFiles().find((f) => f.split(/[\\/]/).at(-2) === slug);
    return liveTypescriptBlocks(readSkill(file)).length;
  };

  assert.deepEqual(
    [count("theokit-client"), count("theokit-models"), count("theokit-sandbox")],
    [4, 5, 4],
  );
});

// ── /review of the widening: four forms it still could not see ───────────────────────────────────

test("`export * from` is a taught import", () => {
  // F-1: the STATEMENT alternation required `* as ident` or a bare identifier before `from`, and
  // `export *` is neither. A skill teaching `export * from "@theokit/newpkg"` would leave every gate
  // green over a package none of them looked at — the same direction B-017 exists to close.
  assert.deepEqual(
    [...importsIn('export * from "@theokit/sdk";\n')].map((i) => i.specifier),
    ["@theokit/sdk"],
  );
});

test("a side-effect import is a taught import", () => {
  // F-1, second half: `import "@theokit/sdk/register";` binds no name and matched nothing.
  assert.deepEqual(
    [...importsIn('import "@theokit/sdk/register";\n')].map((i) => i.specifier),
    ["@theokit/sdk/register"],
  );
});

test("a mixed default-and-braced import keeps BOTH halves", () => {
  // F-2: `import d, { N } from "…"` was dropped ENTIRELY — including the braced half, which is the
  // form the corpus does use. The comma broke both patterns, so the most likely form to appear in
  // real documentation was the one where the widening looked like it should help and did not.
  const found = [...importsIn('import theokit, { Agent, Tool } from "@theokit/sdk";\n')];

  assert.deepEqual(found.map((i) => i.specifier), ["@theokit/sdk"]);
  assert.deepEqual(found.flatMap((i) => i.names).sort(), ["Agent", "Tool", "theokit"]);
});

test("a deprecated fence excludes the NEW import forms too, not only the braced one", () => {
  // F-6: the exclusion was asserted for the new FENCE forms and never for the new IMPORT forms —
  // the one direction of that interaction nothing pinned, in the very interaction the commit gives
  // as the reason `fencePattern()` had to be unified.
  for (const body of [
    '```typescript\nimport gone from "@theokit/gone";\n```',
    '~~~ts\nimport * as gone from "@theokit/gone";\n~~~',
    '````typescript\nexport { Gone } from "@theokit/gone";\n````',
  ]) {
    assert.deepEqual([...importsIn(`❌ Do not:\n\n${body}\n`)], [], body.slice(0, 24));
  }
});

// ── B-025 / B-026: two latent gaps /review measured and this closes ──────────────────────────────

test("an unterminated fence is distinguishable from no fence at all", () => {
  // B-025. The closing group is required, so a fence with no close never matches and the block is
  // dropped SILENTLY. `skill-examples.test.mjs` reports "N skill(s) compiled" — a skill whose only
  // TypeScript example has a typo'd closing fence is counted as compiling with zero blocks read.
  // That is a gate reporting success over an empty set, the same shape `code-quality-golden-rule.md`
  // § 5 records for a mutation run that produced no mutants.
  assert.deepEqual(unterminatedFences("prose only, no fences here\n"), []);
  assert.deepEqual(
    unterminatedFences("```typescript\nconst a = 1;\n"),
    [{ line: 1, fence: "```" }],
  );
});

test("a closed fence is not reported as unterminated", () => {
  // The control. "Match less" satisfies the first assertion above and destroys the reader.
  assert.deepEqual(unterminatedFences("```typescript\nconst a = 1;\n```\n"), []);
  assert.deepEqual(unterminatedFences("~~~ts\nconst a = 1;\n~~~\n"), []);
  assert.deepEqual(unterminatedFences("````typescript\nconst a = 1;\n```\nconst b = 2;\n````\n"), []);
});

test("a tilde run inside an open backtick fence is content, not a second fence", () => {
  // Written expecting TWO unterminated fences, on the reasoning that a backtick fence closed by
  // tildes is not a valid pair so each is its own. The code disagreed and the code was right:
  // CommonMark says that inside an open ``` fence a `~~~` line is literal CONTENT. One fence is
  // open, not two — and a reader that counted two would report a phantom every time a skill shows
  // a tilde fence inside a backtick one.
  //
  // The criterion was wrong and the implementation was right. Recorded rather than quietly
  // corrected, because this is the fourth criterion in this backlog written without running the
  // thing that produces its number.
  const found = unterminatedFences("```typescript\na\n~~~\n");
  assert.deepEqual(found, [{ line: 1, fence: "```" }]);
});

test("an anti-example marked INSIDE a live fence is not taught", () => {
  // B-026. `DEPRECATED_FENCE` inspects only the line immediately preceding the fence, so a
  // disowning marker on the line ABOVE the import but INSIDE the block does not exclude it —
  // measured by /review as yielding `{ specifier: "@theokit/gone", names: ["bad"] }`. Not prose read
  // as code, which the `^[ \t]*` anchor already defeats, but code the author DISOWNED read as taught.
  const text = [
    "```typescript",
    "// ❌ Do not:",
    'import { bad } from "@theokit/gone";',
    'import { good } from "@theokit/sdk";',
    "```",
    "",
  ].join("\n");

  assert.deepEqual(
    [...importsIn(text)].map((i) => i.specifier),
    ["@theokit/sdk"],
  );
});

test("the disowning marker excludes its own line, not the rest of the block", () => {
  // The control for the test above. Excluding to the end of the block is the easy over-correction,
  // and it would silently drop every real import that follows an anti-example inside one fence.
  const text = [
    "```typescript",
    "// ❌ Do not:",
    'import { bad } from "@theokit/gone";',
    "",
    "// Do this instead:",
    'import { good } from "@theokit/sdk";',
    'import { alsoGood } from "@theokit/di";',
    "```",
    "",
  ].join("\n");

  assert.deepEqual(
    [...importsIn(text)].map((i) => i.specifier).sort(),
    ["@theokit/di", "@theokit/sdk"],
  );
});
