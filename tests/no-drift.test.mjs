/**
 * Drift gate for the shipped skill content (SKILL.md + references/*.md).
 *
 * Mirrors @theokit/sdk's tests/lint/claude-template-no-drift so a bad sync (or a
 * hand-edit) can never publish a skill that teaches the removed pre-3.0 API, a
 * phantom subpath, or a non-existent stream event — the #139 failure class.
 *
 * Matches POSITIVE usage only (imports + calls), so anti-pattern prose
 * ("NEVER use `defineTool` — use `Tool.create`") does not false-positive.
 *
 * Run: `npm test` (node --test, zero dependencies).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = join(root, "skills", "theokit-sdk");
const refsDir = join(skillDir, "references");

function skillFiles() {
  const files = [join(skillDir, "SKILL.md")];
  for (const f of readdirSync(refsDir)) if (f.endsWith(".md")) files.push(join(refsDir, f));
  return files;
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
        if (re.test(line)) offenders.push(`${file.replace(root + "/", "")}:${i + 1}  ${line.trim().slice(0, 90)}`);
      });
  }
  return offenders;
}

test("references exist and are non-trivial", () => {
  const refs = readdirSync(refsDir).filter((f) => f.endsWith(".md"));
  assert.ok(refs.length >= 10, `expected >=10 module references, got ${refs.length}`);
  for (const f of refs) {
    assert.ok(readFileSync(join(refsDir, f), "utf8").length > 200, `${f} is too small`);
  }
});

test("no removed factory is imported or called", () => {
  const importRe = new RegExp(String.raw`import\s*\{[^}]*\b(${REMOVED.join("|")})\b[^}]*\}\s*from\s*["']@theokit/sdk`);
  const callRe = new RegExp(String.raw`\b(${REMOVED.join("|")})\s*\(`);
  const offenders = [...scan(importRe), ...scan(callRe)];
  assert.deepEqual(offenders, [], `\nRemoved factory used (use X.create):\n${offenders.join("\n")}\n`);
});

test("no import from a phantom @theokit/sdk subpath", () => {
  const re = new RegExp(String.raw`from\s*["']@theokit/sdk/(${PHANTOM.join("|")})["']`);
  const offenders = scan(re);
  assert.deepEqual(offenders, [], `\nImport from non-existent subpath:\n${offenders.join("\n")}\n`);
});

test("no non-existent stream event type", () => {
  const re = /type\s*[:=]=?\s*["'](tool_use|tool_result|usage|error)["']/;
  const offenders = scan(re);
  assert.deepEqual(offenders, [], `\nNon-existent stream event (use tool_call/assistant/thinking/status):\n${offenders.join("\n")}\n`);
});

test("SKILL.md links every reference file", () => {
  const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
  const missing = readdirSync(refsDir)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => !skill.includes(`references/${f}`));
  assert.deepEqual(missing, [], `\nreferences not linked from SKILL.md: ${missing.join(", ")}\n`);
});
