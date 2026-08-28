#!/usr/bin/env node
// Installs the TheoKit ecosystem's agent skills into whichever AI coding tools this machine has.
//
// One command, every tool, three platforms. The design follows two findings from surveying the
// landscape on 2026-08-20, both of which cut work rather than adding it:
//
//   - `.agents/skills/` is read by Codex, Gemini CLI, GitHub Copilot, Zed and Devin Desktop.
//     Claude Code is the only holdout, reading `.claude/skills/`. Two directories serve six tools,
//     so this installs to LOCATIONS, not to a per-tool adapter list that would write the same
//     bytes five times and then have to keep five copies in step.
//   - Linking beats copying, but only where the source outlives the process — see
//     `lib/install-mode.mjs`. Under `npx` it does not, so that case copies.
//
// Zero dependencies, by design: this runs through `npx` on machines that have installed nothing.

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { TARGETS, detectTargets, targetById } from "../lib/targets.mjs";
import { currentMode, isStableSource, place } from "../lib/install-mode.mjs";
import { digestOf, drift, readManifest, writeManifest } from "../lib/manifest.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = createRequire(import.meta.url)(join(packageRoot, "package.json")).version;
const skillsRoot = join(packageRoot, "skills");
const projectRoot = process.cwd();

// ── arguments ────────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const many = (prefix) =>
  argv.filter((a) => a.startsWith(prefix)).map((a) => a.slice(prefix.length)).filter(Boolean);

const options = {
  global: has("--global"),
  force: has("--force"),
  check: has("--check"),
  dryRun: has("--dry-run"),
  copy: has("--copy"),
  targets: many("--target="),
  skills: many("--skill="),
};

if (has("--help") || has("-h")) {
  usage();
  process.exit(0);
}

const unknown = argv.filter(
  (a) => a.startsWith("-") && !/^--(global|force|check|dry-run|copy|help|target=|skill=)/.test(a) && a !== "-h",
);
if (unknown.length > 0) {
  console.error(`@theokit/skills: unknown option(s): ${unknown.join(", ")}\n`);
  usage();
  process.exit(2);
}

// ── what to install ──────────────────────────────────────────────────────────────────────────

/** Every skill bundled in this package: a directory under `skills/` holding a SKILL.md. */
function bundledSkills() {
  if (!existsSync(skillsRoot)) return [];
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(skillsRoot, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort();
}

const available = bundledSkills();
if (available.length === 0) {
  console.error(`@theokit/skills: no bundled skills found under ${skillsRoot}`);
  process.exit(1);
}

const selected = options.skills.length > 0 ? options.skills : available;
const missingSkill = selected.filter((name) => !available.includes(name));
if (missingSkill.length > 0) {
  console.error(`@theokit/skills: no such skill: ${missingSkill.join(", ")}`);
  console.error(`  bundled: ${available.join(", ")}`);
  process.exit(2);
}

// ── where to install ─────────────────────────────────────────────────────────────────────────

function resolveTargets() {
  if (options.targets.length > 0) {
    const chosen = options.targets.map((id) => [id, targetById(id)]);
    const bad = chosen.filter(([, t]) => t === undefined).map(([id]) => id);
    if (bad.length > 0) {
      console.error(`@theokit/skills: no such target: ${bad.join(", ")}`);
      console.error(`  known: ${TARGETS.map((t) => t.id).join(", ")}`);
      process.exit(2);
    }
    return chosen.map(([, t]) => t);
  }

  const detected = detectTargets(projectRoot);
  // Detecting nothing is the normal first run, not an error: install where the most tools read.
  return detected.length > 0 ? detected : [targetById("agents")];
}

const targets = resolveTargets().filter((target) => {
  if (!options.global) return true;
  if (target.globalDir() !== undefined) return true;
  console.log(`  skipping ${target.label}: it has no personal scope (repository-only)`);
  return false;
});

// A link is only correct in project scope: it points into this project's node_modules, which is
// meaningless from a home directory shared by every project.
const stable = isStableSource(packageRoot, projectRoot);
const preferLink = !options.copy && !options.global && stable;

// ── plan ─────────────────────────────────────────────────────────────────────────────────────

const plan = [];
for (const target of targets) {
  const base = options.global ? target.globalDir() : target.projectDir(projectRoot);
  if (base === undefined) continue;
  for (const skill of selected) {
    plan.push({ target, skill, source: join(skillsRoot, skill), path: join(base, skill) });
  }
}

// ── --check: a CI gate, not an installer ─────────────────────────────────────────────────────

// The scope the MANIFEST describes, which is not always the directory you ran from. A `--global`
// install writes into the home directory and used to record itself in `process.cwd()` — measured
// 2026-08-28: 31 entries reading `../home/.agents/skills/theokit-agent-core`, in a directory chosen
// by nothing but where the operator stood. That file is committable, means nothing from anywhere
// else, and makes `--check` there report on a home install while looking like it describes the
// project it sits in. The installer already branched on scope for WHERE to install (`globalDir()`
// vs `projectDir()`); it did not branch for where to record it. (B-022, W-08 of the B-002 review.)
const scopeRoot = options.global ? homedir() : projectRoot;

if (options.check) {
  const state = drift(scopeRoot, { version });
  if (state.kind === "current") {
    // Counted from the manifest, not from `plan`: `plan` is what an install WOULD do here, and
    // reporting it would state a number about this machine rather than about the install.
    const installed = readManifest(scopeRoot)?.entries.length ?? 0;
    console.log(`@theokit/skills: up to date — ${installed} skill installation(s) at v${version}.`);
    process.exit(0);
  }
  const reason = {
    // Two states share this kind, and the message has to be true of both: no manifest at all, and a
    // manifest this version cannot read. The old wording ("no manifest found — the skills were never
    // installed here") asserted two things that are false in the second case, which is the common one
    // right after a schema bump: the file is right there and the skills ARE installed. (W-06, /review.)
    // A personal install is a common reason for a project check to find nothing, and reporting a
    // bare `absent` sends the reader looking for a broken install that is actually a working one in
    // the other scope. Named rather than hinted. (B-022 DoD.)
    absent: `no readable manifest for this version — either the skills were never installed here, or they were installed by a version whose manifest this one cannot read${
      !options.global && existsSync(join(homedir(), ".theokit-skills.json"))
        ? ". A personal (--global) install does exist; run `--check --global` to report on it"
        : ""
    }`,
    version: `installed from v${state.installed}, this package is v${state.current}`,
    missing: `${state.missing?.length ?? 0} installed path(s) no longer exist`,
    // The kind this gate existed to report and could not. Until B-002 it compared existence only,
    // so an edited instruction file passed — the one failure the module's own header calls "worse
    // than a missing one, because the agent follows it with the same diligence".
    // Two sentences, because the two have different causes and different remedies. A copied skill
    // that drifted was edited here and a reinstall restores it; a LINKED one drifted because the
    // dependency it points into changed under the same version, which no reinstall of this package
    // addresses. The old wording said "no longer match this version" for both — false for the link
    // case in both of its claims. (B-023.)
    content: [
      (state.changed?.length ?? 0) > 0
        && `${state.changed.length} installed skill(s) no longer match this version: ${state.changed.join(", ")}`,
      (state.linked?.length ?? 0) > 0
        && `${state.linked.length} linked skill(s) point at a dependency whose content changed at the same version: ${state.linked.join(", ")}`,
    ].filter(Boolean).join("; "),
  }[state.kind];
  console.error(`@theokit/skills: DRIFT — ${reason}.`);
  console.error("  An instruction file that is out of date is followed as diligently as a current");
  console.error("  one, which is why this is a failure and not a warning.");
  console.error("  Fix: npx @theokit/skills --force");
  process.exit(1);
}

// ── install ──────────────────────────────────────────────────────────────────────────────────

const results = [];
for (const item of plan) {
  if (options.dryRun) {
    results.push({ ...item, mode: preferLink ? "link" : "copy", changed: !existsSync(item.path), linkFailed: false });
    continue;
  }
  results.push({ ...item, ...place(item.source, item.path, { preferLink, force: options.force }) });
}

if (!options.dryRun) {
  writeManifest(scopeRoot, {
    version,
    // `digest` is what makes `--check` able to see a content change. Computed here, at install,
    // because this is the only moment the tree is known to be correct.
    entries: results.map((r) => ({
      skill: r.skill,
      target: r.target.id,
      path: relative(scopeRoot, r.path),
      mode: r.mode,
      digest: digestOf(r.path),
    })),
  });
}

// ── report ───────────────────────────────────────────────────────────────────────────────────

const scope = options.global ? "personal" : "project";
console.log(`\n@theokit/skills v${version} — ${selected.length} skill(s), ${scope} scope${options.dryRun ? " (dry run)" : ""}`);

for (const target of targets) {
  const rows = results.filter((r) => r.target.id === target.id);
  if (rows.length === 0) continue;
  const written = rows.filter((r) => r.changed).length;
  const kept = rows.length - written;
  const mode = rows[0].mode === "link" ? "linked" : "copied";
  console.log(`\n  ${target.label}  →  ${mode}`);
  console.log(`    serves: ${target.serves.join(", ")}`);
  console.log(`    ${written} written${kept > 0 ? `, ${kept} kept (use --force to replace)` : ""}`);
  for (const row of rows) console.log(`      ${row.skill}  ${relative(projectRoot, row.path)}`);
}

const fellBack = results.some((r) => r.linkFailed);
if (fellBack) {
  console.log(`\n  Note: linking was refused by the filesystem, so these were copied instead.`);
  console.log(`  On Windows that usually means junctions are unavailable. Copies work identically`);
  console.log(`  for the agent; they just do not follow \`npm update\` — run \`--check\` in CI.`);
} else if (!preferLink && !options.global && !options.dryRun) {
  console.log(`\n  Copied, not linked: this package is not a dependency of ${relative(resolve(projectRoot, ".."), projectRoot) || "this project"}.`);
  console.log(`  Install it (\`npm i -D @theokit/skills\`) and re-run to have the skills follow your lockfile.`);
}

console.log("");

function usage() {
  console.log(`@theokit/skills — install TheoKit agent skills for every AI coding tool you use

  npx @theokit/skills                 install every bundled skill into the detected tools
  npx @theokit/skills --check         fail if what is installed drifted from this version (CI)

Options
  --global            install for your user instead of this project
  --force             replace what is already there
  --copy              copy even where linking would work
  --dry-run           print the plan, write nothing
  --target=<id>       ${TARGETS.map((t) => t.id).join(" | ")}   (repeatable; default: detected)
  --skill=<name>      install one skill (repeatable; default: all)

Targets
${TARGETS.map((t) => `  ${t.id.padEnd(8)} ${t.label.padEnd(16)} ${t.serves.join(", ")}`).join("\n")}`);
}
