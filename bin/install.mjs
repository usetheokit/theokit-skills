#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The skill directory bundled in this package.
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(packageRoot, "skills", "theokit-sdk");

const args = process.argv.slice(2);
const force = args.includes("--force");
const project = args.includes("--project"); // default is personal (~/.claude)

// Personal (~/.claude/skills) by default so it applies to every project.
// --project installs into the current repo's .claude/skills so it can be committed.
const baseDir = project ? join(process.cwd(), ".claude") : join(homedir(), ".claude");
const targetDir = join(baseDir, "skills", "theokit-sdk");

if (!existsSync(srcDir)) {
  console.error(`@theokit/skill: bundled skill not found at ${srcDir}`);
  process.exit(1);
}

// Copy the skill files, skipping existing ones unless --force.
let added = 0;
let skipped = 0;
mkdirSync(targetDir, { recursive: true });
for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
  const from = join(srcDir, entry.name);
  const to = join(targetDir, entry.name);
  if (force || !existsSync(to)) {
    cpSync(from, to, { recursive: true });
    added++;
  } else {
    skipped++;
  }
}

const scope = project ? "project (.claude/skills)" : "personal (~/.claude/skills)";
console.log(`\n@theokit/skill installed the theokit-sdk skill.`);
console.log(`  scope:  ${scope}`);
console.log(`  path:   ${targetDir}`);
console.log(`  files:  ${added} written${skipped ? `, ${skipped} kept (use --force to overwrite)` : ""}`);
console.log(`\nRestart Claude Code (or it picks up ~/.claude/skills live), then it loads`);
console.log(`automatically when you write @theokit/sdk code, or invoke it with /theokit-sdk.\n`);
