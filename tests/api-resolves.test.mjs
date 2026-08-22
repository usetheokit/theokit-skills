/**
 * Every symbol these skills teach must exist in the installed `@theokit/sdk`.
 *
 * WHY THIS AND NOT THE PATTERN GATE NEXT DOOR. `no-drift.test.mjs` matches names: it knows the
 * twelve factories removed at v3.0 and the two subpaths that never existed, and it catches those.
 * It cannot catch the thirteenth, because nobody has written it down yet. This one does not match
 * names, it RESOLVES them — the compiler is asked whether the module really exports what the skill
 * says, which is the same question a reader's editor asks.
 *
 * WHY IT MATTERS MORE NOW THAN IT DID. These skills used to be authored inside `@theokit/sdk`, so a
 * pull request that removed an export touched them in the same diff and the repo's own gate fired.
 * They live here now, and that coupling is gone: the SDK can delete a symbol tomorrow and nothing
 * here would notice. Measured at the move — the SDK's `check-doc-api-drift` went from 112 verified
 * imports to 43, and the 69 that left were these. This gate is where they land again.
 *
 * `@theokit/sdk` is a devDependency pinned to `latest`, so a scheduled run picks up a published API
 * change without anyone remembering to look. devDependencies never reach a consumer, so `npx
 * @theokit/skills` is unaffected by TypeScript being here.
 *
 * NOT EVERY SPECIFIER CAN BE CHECKED, and the ones that cannot are named rather than skipped.
 * `@theokit/di`, `@theokit/di-agent` and the gateways are separate installs this package does not
 * depend on; a gate that dropped them silently would report coverage it never had.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(root, "skills");
const scratches = [];
after(() => {
  for (const d of scratches) rmSync(d, { recursive: true, force: true });
});

/**
 * A fence a skill deliberately shows as WRONG.
 *
 * The skills teach by contrast — "Before (2.x)" next to "After (3.x)" — so the old import is
 * present ON PURPOSE. The marker is a LABEL line, not prose: an earlier version of this idea in the
 * SDK matched the word "before" anywhere nearby and hid a real finding sitting under a sentence
 * that happened to contain it.
 */
const DEPRECATED_LABEL = /^(before|old|legacy|deprecated|don'?t|do not|instead of|❌|removed)\b.{0,40}:?$/i;

function deprecatedRanges(text) {
  const ranges = [];
  for (const m of text.matchAll(/```[a-z]*\n[\s\S]*?```/g)) {
    const lead = text
      .slice(Math.max(0, m.index - 200), m.index)
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .at(-1)
      ?.trim()
      .replace(/[*_`]/g, "") ?? "";
    if (DEPRECATED_LABEL.test(lead)) ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

/** `import { a, b as c } from "x"` — value and type forms alike, outside deprecated fences. */
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

/** Declared subpath → installed `.d.ts`, for every @theokit package present in node_modules. */
function installedEntries() {
  const paths = {};
  const scope = join(root, "node_modules", "@theokit");
  if (!existsSync(scope)) return paths;
  for (const pkg of readdirSync(scope)) {
    const manifestPath = join(scope, pkg, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const [sub, cond] of Object.entries(manifest.exports ?? {})) {
      const types = cond?.import?.types ?? cond?.types;
      if (typeof types !== "string") continue;
      const file = join(scope, pkg, types);
      if (!existsSync(file)) continue;
      paths[sub === "." ? manifest.name : `${manifest.name}${sub.slice(1)}`] = [file];
    }
  }
  return paths;
}

function collect() {
  const perSkill = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(skillsDir, entry.name, "SKILL.md");
    if (!existsSync(file)) continue;
    for (const imp of importsIn(readFileSync(file, "utf8"))) {
      perSkill.push({ skill: entry.name, ...imp });
    }
  }
  return perSkill;
}

test("every @theokit symbol a skill teaches resolves in the installed package", () => {
  const entries = installedEntries();
  assert.ok(
    entries["@theokit/sdk"] !== undefined,
    "@theokit/sdk must be installed for this gate to check anything — run `npm install`",
  );

  const all = collect();
  const checkable = all.filter((i) => entries[i.specifier] !== undefined);
  assert.ok(checkable.length >= 20, `expected to check >=20 imports, got ${checkable.length}`);

  const dir = mkdtempSync(join(tmpdir(), "theokit-resolve-"));
  scratches.push(dir);

  // A BARE import, deliberately: wrapping the names in a type alias to "use" them would force every
  // one into type position, and every exported FUNCTION would then report "refers to a value but is
  // used as a type" — the probe's own shape, reported as a finding.
  checkable.forEach((imp, i) => {
    writeFileSync(join(dir, `p${i}.ts`), `import { ${imp.names.join(", ")} } from "${imp.specifier}";\n`);
  });
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        noEmit: true,
        strict: false,
        skipLibCheck: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        types: [],
        baseUrl: ".",
        // pnpm isolates node_modules per package, so a probe in /tmp cannot resolve `@theokit/sdk`
        // by ordinary lookup — and a probe that cannot resolve the MODULE reports every name as
        // missing, which reads exactly like the defect being looked for.
        paths: entries,
      },
      include: ["*.ts"],
    }),
  );

  let output = "";
  try {
    execFileSync(join(root, "node_modules", ".bin", "tsc"), ["-p", join(dir, "tsconfig.json")], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (typeof error.status !== "number") {
      // A tsc that never ran is not a clean compile. Reporting `[]` here would be the silent green
      // this whole file exists to prevent.
      throw new Error(`tsc could not be run: ${error.message}`);
    }
    output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }

  const findings = [];
  for (const line of output.split("\n")) {
    const m = /p(\d+)\.ts\(\d+,\d+\): error TS\d+: (.+)$/.exec(line.trim());
    if (m === null) continue;
    const imp = checkable[Number(m[1])];
    if (imp !== undefined) findings.push(`  ${imp.skill}  ${imp.specifier}  ::  ${m[2]}`);
  }

  assert.deepEqual(findings, [], `\n${findings.join("\n")}\n`);
});

test("specifiers this package cannot resolve are named, never silently skipped", () => {
  const entries = installedEntries();
  const unresolvable = [...new Set(collect().map((i) => i.specifier).filter((s) => entries[s] === undefined))].sort();

  // Not a failure: `@theokit/di`, `@theokit/di-agent` and the gateways are separate installs this
  // package deliberately does not depend on. The assertion is that the list stays SHORT and known —
  // if a `@theokit/sdk` subpath ever lands here, the gate stopped covering something it used to.
  const sdkSubpaths = unresolvable.filter((s) => s === "@theokit/sdk" || s.startsWith("@theokit/sdk/"));
  assert.deepEqual(
    sdkSubpaths,
    [],
    `\n@theokit/sdk specifiers that no longer resolve — either the subpath was removed, or the\n` +
      `installed version is too old to have it:\n  ${sdkSubpaths.join("\n  ")}\n`,
  );
});
