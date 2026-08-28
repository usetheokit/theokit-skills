import { test } from "node:test";
import assert from "node:assert/strict";

import { importsIn, liveTypescriptBlocks, skillFiles, readSkill, specifiersIn } from "./_skills.mjs";

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
