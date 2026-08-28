/**
 * The one place that knows how to read the skills.
 *
 * WHY THIS EXISTS. Three test files grew their own copy of the same traversal, and two of them
 * grew diverging copies of the same import extractor: `api-resolves.test.mjs` excluded imports
 * inside a deprecated fence, `no-blind-specifier.test.mjs` did not. `/review` of B-005 caught the
 * divergence as F-arch-1 (HIGH) while it was still latent — both saw the same 29 specifiers,
 * because no skill currently teaches by contrast with an uninstalled package.
 *
 * Latent is the whole point. The exclusion exists because its absence once hid a real finding
 * (see DEPRECATED_FENCE below), and a second gate without it would re-open that the day a skill
 * writes `Before:` above an import of something nobody installs.
 *
 * ADR-2 of records/plans/unify-import-extractors-plan.md: the exclusion is the DEFAULT. A caller
 * that wants raw imports asks for them explicitly, so a fourth gate inherits the safe behaviour
 * without knowing the hazard exists.
 *
 * Not a test file: `node --test` collects `*.test.mjs`, and this is `_skills.mjs`.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(root, "skills");

/**
 * A fence marker that introduces an example the prose is teaching AGAINST.
 *
 * Anchored to the whole line and to a trailing colon, deliberately. An earlier version matched
 * the word anywhere in the preceding lines, and hid a real finding behind an ordinary sentence
 * containing "before" (`api-resolves.test.mjs` header).
 *
 * `❌` is alternated OUTSIDE the `\b` group, and that is a fix rather than a transcription. The
 * original listed `❌` inside the group followed by `\b`, and a word boundary after a non-word
 * character never matches what follows it — so `❌ Do not:` was NEVER excluded, despite the emoji
 * being listed. Measured 2026-08-27 against the original regex: `Don't:` matched, `Before:`
 * matched, `❌ Do not:` did not. Found by the agreement test in this commit.
 *
 * The protections are unchanged and re-verified: `beforehand:` and `Note before you go:` still do
 * not match, which is what the line anchor and the boundary are for.
 */
export const DEPRECATED_FENCE =
  /^(?:❌|(?:before|old|legacy|deprecated|don'?t|do not|instead of)\b).{0,40}:$/i;

/** Byte ranges of fenced blocks that the prose marked as the old way. */
/**
 * The bodies of the live TypeScript fenced blocks in a skill, in document order.
 *
 * Here rather than in the gate that consumes it, because this file already decides what "live"
 * means — `deprecatedRanges` finds the blocks a skill shows as WRONG, and a second reader deciding
 * that question separately is the divergence B-008 spent a cycle removing for import extractors.
 * It happened anyway: `skill-examples.test.mjs` shipped with its own copy, and the two disagreed
 * when a whitespace-only line sat between the marker and the fence — this file skipped it and found
 * `❌ Do not:`, the copy stopped at `"   "`. The gate compiled the anti-example and would have
 * reported the skill broken for showing, correctly, what not to do.
 */
export function liveTypescriptBlocks(text) {
  const skip = deprecatedRanges(text);
  const blocks = [];
  // The fence may be indented, may use tildes, and may be longer than three characters — and the
  // closing fence must be the SAME character repeated at least as many times. The old pattern was
  // `^```` anchored flush left, which did three different things to three forms: it dropped indented
  // and `~~~` fences, and it TRUNCATED four-backtick ones — matching ``` plus a stray backtick and
  // closing at the inner ```, so half an example compiled and the skill was reported as compiling.
  // Truncation is worse than dropping: a dropped block leaves a count short, a truncated one is a
  // wrong answer wearing a right one's clothes. (B-024, EC-1.)
  for (const match of text.matchAll(fencePattern())) {
    const language = (match[3] ?? "").toLowerCase();
    if (language !== "typescript" && language !== "ts") continue;
    if (skip.some(([from, to]) => match.index >= from && match.index < to)) continue;
    // `startLine` is the 1-based line of the block's first BODY line in `text`. Kept rather than
    // discarded: a gate that compiles concatenated blocks reports diagnostics against a virtual
    // file, and without this the address it prints exists nowhere the reader can look.
    const beforeBody = text.slice(0, match.index + match[0].indexOf("\n") + 1);
    blocks.push({ code: match[4], startLine: beforeBody.split("\n").length });
  }
  return blocks;
}

/**
 * Any fenced block: optional indent, three or more backticks OR tildes, closed by the same run.
 *
 * ONE definition, used by both the deprecation scan and the block reader. They had one each, and
 * widening only the reader made anti-examples in the new forms COMPILE — a skill reported broken for
 * correctly showing what not to do. That is the same divergence B-008 removed for import extractors
 * and B-003's review found again in the fence reader; a third instance in the same file would be
 * hard to call an accident.
 *
 * Capture groups: 1 indent, 2 the fence run, 3 the language, 4 the body.
 */
function fencePattern() {
  // The trailing `` `* `` is load-bearing: CommonMark lets a closing fence be LONGER than the
  // opener, and it is what makes a four-backtick block close at its own fence instead of at the
  // inner ```. A `~*` sat beside it with no such motivation — a mixed closer is not a valid fence
  // pair, and accepting `` ```~~~ `` as a close was an unexplained clause in the one regex whose
  // three previous unexplained clauses are the subject of this change. Removed. (F-8, /review.)
  return /^([ \t]*)(`{3,}|~{3,})[ \t]*(\w+)?[^\n]*\n([\s\S]*?)^[ \t]*\2`*[ \t]*$/gm;
}

function deprecatedRanges(text) {
  const ranges = [];
  for (const m of text.matchAll(fencePattern())) {
    const preceding = text
      .slice(Math.max(0, m.index - 200), m.index)
      .split("\n")
      .filter((l) => l.trim());
    if (DEPRECATED_FENCE.test(preceding.at(-1)?.trim() ?? "")) {
      ranges.push([m.index, m.index + m[0].length]);
    }
  }
  return ranges;
}

/**
 * Every `import { a, b as c } from "x"` in `text`, value and type forms alike.
 *
 * Imports inside a deprecated fence are excluded unless `includeDeprecated` is passed — see the
 * module header for why that is the default rather than the option.
 */
export function importsIn(text, { includeDeprecated = false } = {}) {
  const skip = includeDeprecated ? [] : deprecatedRanges(text);
  const found = [];
  // Braced named imports — the overwhelming majority, and the only form the corpus uses today (90 of
  // them @theokit-scoped, 110 counting every specifier — both measured. The oracle in
  // skills-module.test.mjs asserts the scoped number, so a reader reconciling it against a raw
  // grep finds 110; the scope was missing from this sentence and had to be re-derived..
  for (const m of text.matchAll(/import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    if (skip.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const names = m[1]
      .split(",")
      .map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim())
      .filter((n) => n && /^[A-Za-z_$][\w$]*$/.test(n));
    if (names.length > 0) found.push({ specifier: m[2], names });
  }

  // Default, namespace, and re-export. Zero occurrences in the corpus today — built because these
  // feed gates, and a form the reader drops makes every one of them report GREEN over a symbol
  // nobody verified. (B-017.)
  //
  // Anchored to the start of a line, which is the whole difference between a statement and prose:
  // "Do NOT import them from `@theokit/sdk/internal/persistence`" matched a first draft and produced
  // a phantom taught symbol, which would fail a gate against a package that never exported it.
  // A default or namespace binding, optionally followed by a braced list. The `(?:,\s*\{([^}]*)\})?`
  // is what keeps a MIXED import whole: `import d, { N } from "…"` used to be dropped ENTIRELY —
  // including the braced half, which IS the form this corpus uses — because the comma broke the
  // braced pattern and the bare-identifier pattern alike. (F-2, /review.)
  const BINDING = /^[ \t]*(?:import|export)\s+(?:type\s+)?(?:(\*\s*as\s+[A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*))(?:\s*,\s*\{([^}]*)\})?\s+from\s*["']([^"']+)["']/gm;
  for (const m of text.matchAll(BINDING)) {
    if (skip.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const names = [(m[1] ?? m[2] ?? "").replace(/^\*\s*as\s+/, "").trim()];
    for (const n of (m[3] ?? "").split(",")) {
      const clean = n.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
      if (clean && /^[A-Za-z_$][\w$]*$/.test(clean)) names.push(clean);
    }
    const kept = names.filter(Boolean);
    if (kept.length > 0) found.push({ specifier: m[4], names: kept });
  }

  // `export * from "…"` binds no local name, so no identifier pattern reaches it. (F-1.)
  for (const m of text.matchAll(/^[ \t]*export\s*\*\s*from\s*["']([^"']+)["']/gm)) {
    if (skip.some(([a, b]) => m.index >= a && m.index < b)) continue;
    found.push({ specifier: m[1], names: ["*"] });
  }

  // A side-effect import binds nothing at all — `import "@theokit/sdk/register";`. It teaches a
  // SPECIFIER without teaching a symbol, and the specifier is what the drift and resolution gates
  // check. (F-1.)
  for (const m of text.matchAll(/^[ \t]*import\s*["']([^"']+)["']\s*;?[ \t]*$/gm)) {
    if (skip.some(([a, b]) => m.index >= a && m.index < b)) continue;
    found.push({ specifier: m[1], names: [] });
  }

  // `export { X } from "…"` — a re-export with braces, which the first loop skips because it
  // requires the literal `import`.
  for (const m of text.matchAll(/^[ \t]*export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/gm)) {
    if (skip.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const names = m[1]
      .split(",")
      .map((n) => n.trim().split(/\s+as\s+/)[0]?.trim())
      .filter((n) => n && /^[A-Za-z_$][\w$]*$/.test(n));
    if (names.length > 0) found.push({ specifier: m[2], names });
  }
  return found;
}

/** The distinct `@theokit/*` specifiers `text` teaches. Same exclusion, same default. */
export function specifiersIn(text, options) {
  const found = new Set();
  for (const { specifier } of importsIn(text, options)) {
    if (specifier.startsWith("@theokit/")) found.add(specifier);
  }
  return found;
}

/** Every `skills/<name>/SKILL.md` on disk, sorted. */
export function skillFiles() {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(skillsDir, e.name, "SKILL.md"))
    .filter((p) => existsSync(p))
    .sort();
}

/** The directory name of every skill, sorted. */
export function skillNames() {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Read a skill file. Exported so callers never re-derive the encoding. */
export function readSkill(path) {
  return readFileSync(path, "utf8");
}
