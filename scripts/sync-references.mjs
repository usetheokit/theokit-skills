#!/usr/bin/env node
/**
 * Generate skills/theokit-sdk/references/<module>.md from @theokit/sdk's
 * `claude-template` per-module skills — the SINGLE source of truth for the
 * SDK surface (drift-gated by the SDK's own tests/lint/claude-template-no-drift).
 *
 * The references are code snippets, not runnable examples. This keeps ONE
 * authored copy (in @theokit/sdk) instead of a second copy that can drift.
 *
 * Usage:
 *   node scripts/sync-references.mjs                 # resolve @theokit/sdk from node_modules
 *   node scripts/sync-references.mjs --from <dir>    # read a claude-template dir directly
 */
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function resolveTemplateDir() {
  const fromArg = process.argv.indexOf("--from");
  if (fromArg !== -1 && process.argv[fromArg + 1]) return process.argv[fromArg + 1];
  // Resolve the installed @theokit/sdk and derive its claude-template path.
  const sdkPkg = require.resolve("@theokit/sdk/package.json");
  return join(dirname(sdkPkg), "claude-template");
}

const templateDir = resolveTemplateDir();
const skillsSrc = join(templateDir, "dot-claude", "skills");
if (!existsSync(skillsSrc)) {
  console.error(`sync-references: no skills at ${skillsSrc}. Pass --from <claude-template dir>.`);
  process.exit(1);
}

const refsDir = join(pkgRoot, "skills", "theokit-sdk", "references");
rmSync(refsDir, { recursive: true, force: true });
mkdirSync(refsDir, { recursive: true });

/** Strip YAML frontmatter (leading `---` block). */
function stripFrontmatter(md) {
  if (!md.startsWith("---")) return md;
  const end = md.indexOf("\n---", 3);
  return end === -1 ? md : md.slice(md.indexOf("\n", end + 1) + 1).replace(/^\n+/, "");
}

const generated = [];
for (const entry of readdirSync(skillsSrc, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const skillFile = join(skillsSrc, entry.name, "SKILL.md");
  if (!existsSync(skillFile)) continue;
  const module = entry.name.replace(/^theokit-/, ""); // theokit-tools -> tools
  const body = stripFrontmatter(readFileSync(skillFile, "utf8")).trimEnd();
  const header = `<!-- Generated from @theokit/sdk claude-template/${entry.name}. Do not edit by hand; run \`node scripts/sync-references.mjs\`. -->\n\n`;
  writeFileSync(join(refsDir, `${module}.md`), header + body + "\n");
  generated.push(module);
}

generated.sort();
console.log(`sync-references: wrote ${generated.length} module references from ${templateDir}`);
console.log(`  ${generated.join(", ")}`);
