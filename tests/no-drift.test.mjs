/**
 * Drift gate over every shipped skill.
 *
 * These skills are what an agent reads before it writes `@theokit/sdk` code, so a skill teaching a
 * removed factory or a subpath that does not exist produces confidently wrong code — the #139
 * failure class. That is why this is a gate and not a lint.
 *
 * It moved here with the skills themselves. They used to be authored inside `@theokit/sdk`'s
 * `claude-template/` and copied into this package by a sync script that stripped their frontmatter —
 * so the copy lost the `paths:` globs that make a skill load only when it is relevant, which was the
 * best property the originals had. One authored home, frontmatter intact, one gate.
 *
 * Patterns match POSITIVE usage only (imports and calls), so anti-pattern prose
 * ("NEVER use `defineTool` — use `Tool.create`") does not false-positive. That is deliberate: the
 * skills teach by contrast, and a gate that forbade naming the old API would forbid explaining it.
 *
 * WHAT THIS CANNOT DO, stated rather than implied: it matches names, it does not resolve them. A
 * skill importing a symbol that never existed passes here. The stronger oracle is
 * `@theokit/sdk`'s `docs/harness-capability-map.md` — every public symbol with the exact specifier
 * to import it from — which would turn this into a resolution check with no TypeScript needed. It
 * is not used yet because the published `@theokit/sdk` does not carry `docs/` until its next
 * release. Wire it the day it does.
 *
 * Run: `npm test` (node --test, zero dependencies).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(root, "skills");

/** Every skill directory in the package. */
function skillNames() {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function skillFiles() {
  return skillNames().map((n) => join(skillsDir, n, "SKILL.md"));
}

/** The YAML frontmatter block of a skill, as raw text. `undefined` when absent. */
function frontmatter(file) {
  const text = readFileSync(file, "utf8");
  if (!text.startsWith("---")) return undefined;
  const end = text.indexOf("\n---", 3);
  return end === -1 ? undefined : text.slice(4, end);
}

// Removed at @theokit/sdk v3.0 (SE36) — replaced by the uniform X.create() API.
const REMOVED = [
  "defineTool",
  "defineProvider",
  "definePlugin",
  "defineSubAgent",
  "defineSubscription",
  "defineAuth",
  "defineSkillReadTool",
  "createAgentFactory",
  "createSquad",
  "createSkill",
  "createSessionManager",
  "createSemaphore",
];
// Import subpaths NOT in @theokit/sdk's exports map (coding tools = @theokit/sdk-tools).
const PHANTOM = ["rag", "tools"];

function scan(re) {
  const offenders = [];
  for (const file of skillFiles()) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (re.test(line)) {
          offenders.push(`${file.replace(`${root}/`, "")}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      });
  }
  return offenders;
}

test("the package ships the whole module surface, not a sample", () => {
  const names = skillNames();
  assert.ok(names.includes("theokit-sdk"), "the umbrella skill must be present");
  assert.ok(names.length >= 30, `expected >=30 skills, got ${names.length}`);
});

test("every skill is a valid Agent Skill: name matches its directory, description present", () => {
  const broken = [];
  for (const name of skillNames()) {
    const front = frontmatter(join(skillsDir, name, "SKILL.md"));
    if (front === undefined) {
      broken.push(`${name}: no frontmatter`);
      continue;
    }
    const declared = /^name:\s*(\S+)/m.exec(front)?.[1];
    // The spec requires `name`, and requires it to equal the directory. Claude Code infers it from
    // the path and forgives the omission; Codex, Gemini and Copilot read the open format and do not.
    if (declared !== name) broken.push(`${name}: name is ${declared ?? "missing"}`);
    if (!/^description:\s*\S/m.test(front)) broken.push(`${name}: no description`);
  }
  assert.deepEqual(broken, [], `\n${broken.join("\n")}\n`);
});

test("no removed factory is imported or called", () => {
  const re = new RegExp(`(?:import\\s*\\{[^}]*\\b(?:${REMOVED.join("|")})\\b|\\b(?:${REMOVED.join("|")})\\s*\\()`);
  assert.deepEqual(scan(re), [], "\nremoved pre-3.0 API taught as current\n");
});

test("no import from a phantom @theokit/sdk subpath", () => {
  const re = new RegExp(`from\\s+["']@theokit/sdk/(?:${PHANTOM.join("|")})["']`);
  assert.deepEqual(scan(re), [], "\nimport from a subpath the package does not export\n");
});

test("no non-existent stream event type", () => {
  assert.deepEqual(scan(/type:\s*["']tool_use["']/), [], "\n`tool_use` is not an SDKMessage type\n");
});

test("the umbrella skill names every sibling, so none ships invisible", () => {
  const umbrella = readFileSync(join(skillsDir, "theokit-sdk", "SKILL.md"), "utf8");
  const unlisted = skillNames().filter((n) => n !== "theokit-sdk" && !umbrella.includes(n));
  // A skill nobody is told about is a skill nobody loads on purpose. The globs make it load when it
  // matches, but a reader deciding what this package covers reads the umbrella.
  assert.deepEqual(unlisted, [], `\nnot named in theokit-sdk/SKILL.md: ${unlisted.join(", ")}\n`);
});
