/**
 * Every symbol a skill teaches must exist in the installed `@theokit/sdk`.
 *
 * The sibling drift gate matches NAMES — it catches a removed factory it was told about. This one
 * RESOLVES them: each `import { … } from "@theokit/sdk…"` in every SKILL.md becomes a probe file
 * compiled against the package's published declarations, so a symbol that never existed, or one
 * imported from a subpath that does not export it, fails here. Pattern matching cannot see either.
 *
 * The oracle is the PUBLISHED package in `node_modules`, not the SDK's working tree. That is the
 * contract a reader of these skills actually has installed, and gating against a local checkout
 * would pass on APIs nobody can call yet.
 *
 * TWO SHAPES THAT COST REAL TIME WHEN THIS WAS FIRST BUILT, both preserved here deliberately:
 *
 *   - The probe is a BARE import. An earlier version appended `export type __N = [A, B]` to keep
 *     the names used, which forced every name into TYPE position — so each exported FUNCTION
 *     reported "refers to a value, but is being used as a type" and 83 of 101 findings were the
 *     probe's own shape rather than a defect.
 *   - `paths` is mapped explicitly. pnpm isolates `node_modules` per package, so a probe compiled
 *     without it cannot resolve the MODULE at all — and a module that does not resolve reports
 *     every name as missing, which reads exactly like the defect being looked for.
 *
 * Specifiers this cannot check are NAMED rather than skipped: `@theokit/di`, `@theokit/di-agent`
 * and the gateway packages are not installed here, and a gate that quietly ignored them would
 * report a coverage it never had.
 *
 * The compiler runs IN PROCESS. An earlier version spawned `npx tsc`, which fails on Windows with
 * `spawnSync npx ENOENT` — the executable there is `npx.cmd`, and `execFileSync` does not resolve
 * it. Guessing the right binary name per platform is the wrong fix when `typescript` is a direct
 * devDependency: `ts.createProgram` removes the subprocess, the platform difference and the startup
 * cost at once.
 *
 * Run: `npm test` (node --test; uses the `typescript` devDependency, which consumers never install).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(root, "skills");
const ts = createRequire(import.meta.url)("typescript");

/** Packages installed here, so the gate can say what it did and did not check. */
function installedPackages() {
  const scope = join(root, "node_modules", "@theokit");
  if (!existsSync(scope)) return new Set();
  return new Set(readdirSync(scope).map((n) => `@theokit/${n}`));
}

/**
 * Fenced blocks a skill deliberately shows as WRONG.
 *
 * The skills teach by contrast — "Before (1.x): …" followed by the current call. Reporting those is
 * the instrument failing to read, not the skill failing to be true. The marker is a LABEL line, not
 * prose: an earlier version matched the word anywhere in the preceding lines and hid a real finding
 * behind an ordinary sentence containing "before".
 */
const DEPRECATED_FENCE = /^(before|old|legacy|deprecated|don'?t|do not|instead of|❌)\b.{0,40}:$/i;

function deprecatedRanges(text) {
  const ranges = [];
  for (const m of text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
    const preceding = text.slice(Math.max(0, m.index - 200), m.index).split("\n").filter((l) => l.trim());
    if (DEPRECATED_FENCE.test(preceding.at(-1)?.trim() ?? "")) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

/** `import { a, b as c } from "x"` — value and type forms alike. */
function importsIn(text) {
  const skip = deprecatedRanges(text);
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

function skillFiles() {
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(skillsDir, e.name, "SKILL.md"))
    .filter((p) => existsSync(p))
    .sort();
}

/** Declared subpath → its built `.d.ts`, for an installed package. */
function typePaths(pkg) {
  const dir = join(root, "node_modules", ...pkg.split("/"));
  const manifest = join(dir, "package.json");
  if (!existsSync(manifest)) return {};
  const meta = JSON.parse(readFileSync(manifest, "utf8"));
  const out = {};
  for (const [sub, cond] of Object.entries(meta.exports ?? {})) {
    const types = cond?.import?.types ?? cond?.types;
    if (typeof types !== "string") continue;
    const file = join(dir, types);
    if (existsSync(file)) out[sub === "." ? pkg : `${pkg}${sub.slice(1)}`] = [file];
  }
  return out;
}

test("every @theokit symbol a skill teaches resolves in the installed package", () => {
  const installed = installedPackages();
  const paths = {};
  for (const pkg of installed) Object.assign(paths, typePaths(pkg));
  assert.ok(Object.keys(paths).length > 0, "no installed @theokit package has built declarations — run `npm install`");

  const probes = [];
  const unchecked = new Set();
  for (const file of skillFiles()) {
    for (const { specifier, names } of importsIn(readFileSync(file, "utf8"))) {
      if (!specifier.startsWith("@theokit/")) continue;
      if (paths[specifier] === undefined) {
        unchecked.add(specifier);
        continue;
      }
      probes.push({ file, specifier, names });
    }
  }
  assert.ok(probes.length > 0, "no checkable import found — the extractor is broken, not the skills");

  // One in-memory program over synthetic probe files: no temp directory, no subprocess, no
  // platform-specific executable name.
  const sources = new Map(
    probes.map((p, i) => [`p${i + 1}.ts`, `import { ${p.names.join(", ")} } from "${p.specifier}";\n`]),
  );
  const options = {
    noEmit: true,
    strict: false,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
    baseUrl: root,
    // pnpm and npm both isolate `node_modules`, so a probe compiled without an explicit map cannot
    // resolve the MODULE — and a module that does not resolve reports every name as missing, which
    // reads exactly like the defect being looked for.
    paths,
  };
  const host = ts.createCompilerHost(options, true);
  const readOriginal = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, ...rest) => {
    const synthetic = sources.get(name);
    return synthetic === undefined
      ? readOriginal(name, languageVersion, ...rest)
      : ts.createSourceFile(name, synthetic, languageVersion, true);
  };
  host.fileExists = (name) => sources.has(name) || existsSync(name);
  host.readFile = (name) => sources.get(name) ?? (existsSync(name) ? readFileSync(name, "utf8") : undefined);

  const program = ts.createProgram([...sources.keys()], options, host);
  const findings = [];
  for (const diagnostic of program.getSemanticDiagnostics()) {
    const name = diagnostic.file?.fileName;
    const index = name === undefined ? -1 : Number(/^p(\d+)\.ts$/.exec(name)?.[1] ?? 0) - 1;
    const probe = probes[index];
    if (probe === undefined) continue;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
    findings.push(`${probe.file.replace(`${root}/`, "")}  ${probe.specifier}  ::  ${message}`);
  }

  // Reported on success too: a gate that silently narrows its own scope claims coverage it lacks.
  if (unchecked.size > 0) {
    console.log(`  not checked (not installed here): ${[...unchecked].sort().join(", ")}`);
  }
  console.log(`  ${probes.length} import(s) resolved against the installed @theokit packages`);
  assert.deepEqual(findings, [], `\n${findings.join("\n")}\n`);
});
