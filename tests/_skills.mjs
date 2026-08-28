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
  for (const match of text.matchAll(/^```(\w+)?[^\n]*\n([\s\S]*?)^```/gm)) {
    const language = (match[1] ?? "").toLowerCase();
    if (language !== "typescript" && language !== "ts") continue;
    if (skip.some(([from, to]) => match.index >= from && match.index < to)) continue;
    blocks.push(match[2]);
  }
  return blocks;
}

function deprecatedRanges(text) {
  const ranges = [];
  for (const m of text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
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
  for (const m of text.matchAll(/import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    if (skip.some(([a, b]) => m.index >= a && m.index < b)) continue;
    const names = m[1]
      .split(",")
      .map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim())
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
