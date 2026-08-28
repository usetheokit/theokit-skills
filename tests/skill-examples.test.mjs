import { test } from "node:test";
import assert from "node:assert/strict";

import { DEPRECATED_FENCE, readSkill, skillFiles, skillNames } from "./_skills.mjs";
import { compile } from "./_typecheck.mjs";

/**
 * The skills whose TypeScript examples compile against the installed packages.
 *
 * An explicit list, edited by hand, and that is the whole design. B-003's first measurement gated
 * the entire corpus and refused the result: 17% of blocks compiled alone, 9.7% of skills compile
 * concatenated, and ~165 findings per run "is how a team learns to ignore a gate".
 *
 * So this is a ratchet. A listed skill that stops compiling turns the suite red; a skill joins the
 * list when someone fixes it and edits this array. It is NOT derived at run time from "whichever
 * skills happen to compile" — a gate that picks its own scope by its own result cannot fail, and
 * would shrink silently as skills broke. (ADR-2 of the plan; the same defect B-010 shipped once.)
 */
const COMPILES = ["theokit-client", "theokit-models", "theokit-sandbox"];

const FENCE = /^```(\w+)?[^\n]*\n([\s\S]*?)^```/gm;

/** The live TypeScript blocks of one skill, in document order, concatenated. */
function exampleBody(text) {
  const blocks = [];
  let match;
  FENCE.lastIndex = 0;
  while ((match = FENCE.exec(text)) !== null) {
    const language = (match[1] ?? "").toLowerCase();
    if (language !== "typescript" && language !== "ts") continue;
    // A block introduced by a deprecated marker teaches by contrast. Compiling it would report the
    // skill as broken for showing, on purpose, what not to do.
    const preceding = text.slice(0, match.index).split("\n").filter(Boolean).at(-1) ?? "";
    if (DEPRECATED_FENCE.test(preceding.trim())) continue;
    blocks.push(match[2]);
  }
  // Concatenated, not compiled one by one: B-003's second measurement showed block 3 uses what
  // block 1 declared, and per-block compilation produced 485 `TS2304 Cannot find name` against 113
  // for the whole skill — a 77% drop that is instrument artefact, not corpus defect.
  return blocks.join("\n");
}

function bodyOf(slug) {
  const file = skillFiles().find((f) => f.endsWith(`/${slug}/SKILL.md`));
  return file === undefined ? undefined : exampleBody(readSkill(file));
}

/**
 * What is wrong with an allowlist, before any compiling happens.
 *
 * Extracted rather than asserted inline because both cases are absent from the real corpus — every
 * skill has a live TypeScript block today — and a guard whose trigger cannot occur is only reachable
 * through synthetic input. A behaviour worth asserting has to be reachable by an assertion.
 */
export function allowlistProblems(slugs, resolve) {
  const problems = [];
  for (const slug of slugs) {
    const body = resolve(slug);
    // EC-2: an entry naming no skill would shrink the gate by an edit nobody reviewed as a scope
    // change. Absence of a subject is never a clean result.
    if (body === undefined) {
      problems.push({ slug, kind: "no-such-skill" });
      continue;
    }
    // EC-1: a skill with no live block presents an empty source, and zero diagnostics over zero code
    // is a pass — the shape B-010 shipped once and had to rewrite.
    if (body.trim() === "") problems.push({ slug, kind: "nothing-to-compile" });
  }
  return problems;
}

test("every allowlisted skill's examples compile", () => {
  assert.deepEqual(allowlistProblems(COMPILES, bodyOf), []);

  const sources = Object.fromEntries(COMPILES.map((slug) => [`${slug}.ts`, bodyOf(slug)]));
  const diagnostics = compile(sources);

  const total = skillNames().length;
  console.log(`  ${COMPILES.length} skill(s) compiled, ${total - COMPILES.length} not in the allowlist`);
  assert.deepEqual(
    diagnostics.map((d) => `${d.file}:${d.line}  TS${d.code}  ${d.message}`),
    [],
  );
});

test("an allowlist entry naming no skill fails, and names the entry", () => {
  const problems = allowlistProblems(["theokit-does-not-exist"], () => undefined);

  assert.deepEqual(problems, [{ slug: "theokit-does-not-exist", kind: "no-such-skill" }]);
});

test("an allowlisted skill with nothing to compile fails, and names the skill", () => {
  // Absent from the corpus today — every skill has a live block, measured. Guarded now precisely
  // because it cannot happen yet: a skill whose examples are all deleted, or all moved behind a
  // deprecated fence, would otherwise be reported as compiling while nothing was compiled.
  const problems = allowlistProblems(["theokit-emptied"], () => "   \n  ");

  assert.deepEqual(problems, [{ slug: "theokit-emptied", kind: "nothing-to-compile" }]);
});

test("a defect in the BODY of an allowlisted skill turns the suite red", () => {
  // The control B-003's discovery measured, promoted from a probe to a test. It is what separates
  // "the gate compiles something" from "the gate would notice if it broke".
  const body = bodyOf(COMPILES[0]);
  assert.deepEqual(compile({ "control.ts": body }), [], "the control must be clean before it is broken");

  const broken = compile({ "control.ts": `${body}\nconst __control: number = "not a number";\n` });

  assert.equal(broken.length, 1);
  assert.equal(broken[0].code, 2322);
});
