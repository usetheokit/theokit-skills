# Example Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the checker that enforces the example contract, and bring `capabilities/memory` up to that contract so the first skill has a conformant source.

**Architecture:** Three pure modules in `@theokit/skills` — a region parser, a manifest validator, and a contract checker that composes them — plus a thin CLI. The knowledge lives in `theokit-skills` because the generator and the checker must agree byte-for-byte on what a region is; duplicating that parser in `theokit-examples` would be duplicating business logic. `theokit-examples` gets the human-readable contract, a conformant `memory` example, and a script that calls the checker.

**Tech Stack:** Node >= 22.12.0, ESM `.mjs`, `node --test` (built in), zero runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-28-theokit-skills-redesign-design.md`

## Global Constraints

- **Everything in English.** Code, comments, docs, commit messages, JSON field values. This is a project rule; the lint that enforced it (`tests/lint/no-ptbr.test.mjs`) was deleted by commit `9c2e340` and has not been replaced, so nothing catches a violation automatically.
- **Zero runtime dependencies** in `@theokit/skills`. Test-only devDependencies are fine.
- **Node >= 22.12.0** — `package.json` declares this floor. No syntax or API above it.
- **ESM only.** `.mjs` files; the package declares `"type": "module"`.
- **Git:** work on the `workspace` branch. Never commit to `develop` or `main`. No `git checkout`, no `git revert`, no `reset --hard`, no force-push.
- **Every `@theokit/*` dependency in an example is pinned exactly** — `4.61.0`, never `^`, `~` or `latest`.
- **Do not publish to npm during this plan.** `skills/` is empty, so a release now would ship an installer with no skills.

## Repository paths

- `theokit-skills` — `/home/paulo/Projetos/theo/theokit-framework/theokit-skills` (tasks 1-5)
- `theokit-examples` — `/home/paulo/Projetos/theo/theokit-framework/theokit-examples` (tasks 6-7, no initial commit on `workspace` yet)

## File structure

| File | Responsibility |
|---|---|
| `lib/regions.mjs` | Parse `#region skill:<id>` markers out of one source file. Nothing else. |
| `lib/skill-manifest.mjs` | Validate and normalize one `skill.json`. Knows the schema, knows nothing about the filesystem. |
| `lib/example-contract.mjs` | Compose the two above with filesystem facts into a list of violations for one example directory. |
| `bin/check-example.mjs` | CLI: walk a tree, find `skill.json` files, report violations, exit non-zero on any. |
| `tests/regions.test.mjs` | Region parser behavior. |
| `tests/skill-manifest.test.mjs` | Manifest validation behavior. |
| `tests/example-contract.test.mjs` | Contract rules, against fixtures built in temp directories. |
| `tests/_fixture.mjs` | Shared helper that writes a minimal conformant example to a temp dir so each test breaks exactly one rule. |

---

### Task 1: Region parser

**Files:**
- Create: `lib/regions.mjs`
- Test: `tests/regions.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseRegions(source: string, file: string) => Region[]` where `Region` is `{ id: string, file: string, startLine: number, endLine: number, code: string }`; `dedent(code: string) => string`; `class RegionError extends Error` with `.file` and `.line`.

`code` is the raw text between the markers, markers excluded. `dedent` removes the smallest indentation common to all non-blank lines. Both the checker and, later, the generator must apply `dedent` before comparing or publishing, so that gate G1 compares like with like.

- [ ] **Step 1: Write the failing test**

Create `tests/regions.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { dedent, parseRegions, RegionError } from "../lib/regions.mjs";

test("parses one region and excludes its markers", () => {
  const source = [
    "const before = 1;",
    "// #region skill:create-agent",
    "const agent = 2;",
    "// #endregion",
    "const after = 3;",
  ].join("\n");

  const regions = parseRegions(source, "src/a.ts");

  assert.equal(regions.length, 1);
  assert.equal(regions[0].id, "create-agent");
  assert.equal(regions[0].file, "src/a.ts");
  assert.equal(regions[0].startLine, 2);
  assert.equal(regions[0].endLine, 4);
  assert.equal(regions[0].code, "const agent = 2;");
});

test("keeps comments inside a region, because that is where the hard-won prose lives", () => {
  const source = [
    "// #region skill:ask",
    "// TWO CALLS, not one. send() hands back a handle.",
    "const run = await agent.send(message);",
    "// #endregion",
  ].join("\n");

  const [region] = parseRegions(source, "src/a.ts");

  assert.match(region.code, /TWO CALLS, not one/);
});

test("a region that is never closed names the file and the opening line", () => {
  const source = ["// #region skill:orphan", "const a = 1;"].join("\n");

  const error = assert.throws(() => parseRegions(source, "src/a.ts"), RegionError);
  assert.equal(error.file, "src/a.ts");
  assert.equal(error.line, 1);
  assert.match(error.message, /orphan/);
});

test("a nested region is rejected, naming both ids", () => {
  const source = [
    "// #region skill:outer",
    "// #region skill:inner",
    "// #endregion",
    "// #endregion",
  ].join("\n");

  const error = assert.throws(() => parseRegions(source, "src/a.ts"), RegionError);
  assert.match(error.message, /inner/);
  assert.match(error.message, /outer/);
});

test("an #endregion with no open region is rejected", () => {
  const error = assert.throws(() => parseRegions("// #endregion", "src/a.ts"), RegionError);
  assert.equal(error.line, 1);
});

test("a non-kebab-case id is not recognised as a region marker", () => {
  assert.deepEqual(parseRegions("// #region skill:Create_Agent", "src/a.ts"), []);
});

test("dedent removes the common indentation and leaves relative indentation intact", () => {
  const code = ["    const a = 1;", "", "      const b = 2;"].join("\n");

  assert.equal(dedent(code), ["const a = 1;", "", "  const b = 2;"].join("\n"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/regions.test.mjs`
Expected: FAIL — `Cannot find module '../lib/regions.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `lib/regions.mjs`:

```js
/**
 * Region markers are the contract between an example that runs and a skill that ships. Everything
 * between the markers is copied verbatim into the skill, comments included: an example's doc
 * comments record what a signature cannot, and paraphrasing them would lose the only content here
 * that no model could reproduce.
 */

const OPEN = /^\s*\/\/\s*#region\s+skill:([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/;
const CLOSE = /^\s*\/\/\s*#endregion\s*$/;

export class RegionError extends Error {
  constructor(message, { file, line }) {
    super(`${file}:${line}: ${message}`);
    this.name = "RegionError";
    this.file = file;
    this.line = line;
  }
}

/**
 * Parse the regions declared in one source file.
 *
 * An id that is not kebab-case does not match OPEN and is therefore not a region at all, rather
 * than a malformed one. The manifest cross-check in `example-contract.mjs` is what turns a typo
 * into a named error: the id it declares will have no match here.
 */
export function parseRegions(source, file) {
  const regions = [];
  let open = null;

  source.split("\n").forEach((text, index) => {
    const line = index + 1;

    const opened = OPEN.exec(text);
    if (opened !== null) {
      const id = opened[1];
      if (open !== null) {
        throw new RegionError(`region "${id}" opens inside region "${open.id}"`, { file, line });
      }
      open = { id, startLine: line, body: [] };
      return;
    }

    if (CLOSE.test(text)) {
      if (open === null) {
        throw new RegionError("#endregion with no open region", { file, line });
      }
      regions.push({
        id: open.id,
        file,
        startLine: open.startLine,
        endLine: line,
        code: open.body.join("\n"),
      });
      open = null;
      return;
    }

    if (open !== null) open.body.push(text);
  });

  if (open !== null) {
    throw new RegionError(`region "${open.id}" is never closed`, { file, line: open.startLine });
  }

  return regions;
}

/**
 * Remove the indentation every non-blank line shares.
 *
 * Regions are usually cut from inside a function, so their raw text carries the enclosing
 * indentation. Both the checker and the generator dedent before comparing, so that gate G1
 * compares the same normalisation on both sides.
 */
export function dedent(code) {
  const lines = code.split("\n");
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.length - line.trimStart().length);

  if (indents.length === 0) return code;

  const common = Math.min(...indents);
  return lines.map((line) => (line.trim().length === 0 ? line : line.slice(common))).join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/regions.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/regions.mjs tests/regions.test.mjs
git commit -m "feat(regions): parse skill region markers, comments included"
```

---

### Task 2: Manifest validator

**Files:**
- Create: `lib/skill-manifest.mjs`
- Test: `tests/skill-manifest.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseManifest(raw: unknown, path: string) => Manifest`; `class ManifestError extends Error` with `.path` and `.field`.

`Manifest` is `{ skill, teaches, concept, triggers, regions, notCovered, credentials, evidence }`. `regions` is an ordered array of `{ id, explains }` — array order is teaching order. `credentials` may be empty; `evidence` defaults to `[]`. Everything else must be non-empty, because a manifest that declares nothing declares nothing useful.

- [ ] **Step 1: Write the failing test**

Create `tests/skill-manifest.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { ManifestError, parseManifest } from "../lib/skill-manifest.mjs";

const VALID = {
  skill: "theokit-memory",
  teaches: ["@theokit/sdk/memory"],
  concept: "Memory that persists across agent runs",
  triggers: ["memory", "remember across sessions"],
  regions: [{ id: "create-agent-with-memory", explains: "Enabling memory when creating the agent" }],
  notCovered: ["external adapters: mem0, honcho, supermemory"],
  credentials: ["ANTHROPIC_API_KEY"],
};

test("accepts a complete manifest and defaults evidence to an empty list", () => {
  const manifest = parseManifest(VALID, "capabilities/memory/skill.json");

  assert.equal(manifest.skill, "theokit-memory");
  assert.deepEqual(manifest.evidence, []);
});

test("preserves region order, because array order is teaching order", () => {
  const manifest = parseManifest(
    { ...VALID, regions: [{ id: "second", explains: "b" }, { id: "first", explains: "a" }] },
    "p",
  );

  assert.deepEqual(manifest.regions.map((region) => region.id), ["second", "first"]);
});

test("rejects a skill name without the theokit- prefix, naming the field", () => {
  const error = assert.throws(() => parseManifest({ ...VALID, skill: "memory" }, "p"), ManifestError);
  assert.equal(error.field, "skill");
});

test("rejects an empty notCovered, because the honest gap is the point", () => {
  const error = assert.throws(() => parseManifest({ ...VALID, notCovered: [] }, "p"), ManifestError);
  assert.equal(error.field, "notCovered");
});

test("rejects a teaches entry that is not an export subpath of a @theokit package", () => {
  const error = assert.throws(() => parseManifest({ ...VALID, teaches: ["lodash"] }, "p"), ManifestError);
  assert.equal(error.field, "teaches");
});

test("rejects a region id that is not kebab-case, because no marker could ever match it", () => {
  const error = assert.throws(
    () => parseManifest({ ...VALID, regions: [{ id: "Create_Agent", explains: "x" }] }, "p"),
    ManifestError,
  );
  assert.equal(error.field, "regions");
});

test("rejects an evidence entry missing its claim", () => {
  const error = assert.throws(
    () => parseManifest({ ...VALID, evidence: [{ command: "npm start" }] }, "p"),
    ManifestError,
  );
  assert.equal(error.field, "evidence");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/skill-manifest.test.mjs`
Expected: FAIL — `Cannot find module '../lib/skill-manifest.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `lib/skill-manifest.mjs`:

```js
/** The schema of `skill.json`, which is one half of the contract between the two repositories. */

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEACHES = /^@theokit\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;

export class ManifestError extends Error {
  constructor(message, { path, field }) {
    super(`${path}: ${field}: ${message}`);
    this.name = "ManifestError";
    this.path = path;
    this.field = field;
  }
}

function requireNonEmptyStrings(value, { path, field }) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ManifestError("must be a non-empty array", { path, field });
  }
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new ManifestError("every entry must be a non-empty string", { path, field });
    }
  }
  return value;
}

export function parseManifest(raw, path) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ManifestError("must be a JSON object", { path, field: "<root>" });
  }

  const skill = raw.skill;
  if (typeof skill !== "string" || !skill.startsWith("theokit-") || !KEBAB.test(skill)) {
    throw new ManifestError('must be kebab-case and start with "theokit-"', { path, field: "skill" });
  }

  const concept = raw.concept;
  if (typeof concept !== "string" || concept.trim().length === 0) {
    throw new ManifestError("must be a non-empty string", { path, field: "concept" });
  }

  const teaches = requireNonEmptyStrings(raw.teaches, { path, field: "teaches" });
  for (const entry of teaches) {
    if (!TEACHES.test(entry)) {
      throw new ManifestError(`"${entry}" is not a @theokit export subpath`, { path, field: "teaches" });
    }
  }

  const triggers = requireNonEmptyStrings(raw.triggers, { path, field: "triggers" });
  const notCovered = requireNonEmptyStrings(raw.notCovered, { path, field: "notCovered" });

  if (!Array.isArray(raw.regions) || raw.regions.length === 0) {
    throw new ManifestError("must be a non-empty array", { path, field: "regions" });
  }
  const regions = raw.regions.map((region) => {
    if (region === null || typeof region !== "object") {
      throw new ManifestError("every entry must be an object", { path, field: "regions" });
    }
    if (typeof region.id !== "string" || !KEBAB.test(region.id)) {
      throw new ManifestError(`id "${region.id}" must be kebab-case`, { path, field: "regions" });
    }
    if (typeof region.explains !== "string" || region.explains.trim().length === 0) {
      throw new ManifestError(`region "${region.id}" needs a non-empty explains`, { path, field: "regions" });
    }
    return { id: region.id, explains: region.explains };
  });

  const credentials = raw.credentials ?? [];
  if (!Array.isArray(credentials) || credentials.some((entry) => typeof entry !== "string")) {
    throw new ManifestError("must be an array of strings", { path, field: "credentials" });
  }

  const evidence = (raw.evidence ?? []).map((entry) => {
    if (
      entry === null ||
      typeof entry !== "object" ||
      typeof entry.command !== "string" ||
      typeof entry.claims !== "string" ||
      entry.command.trim().length === 0 ||
      entry.claims.trim().length === 0
    ) {
      throw new ManifestError("every entry needs a command and a claims", { path, field: "evidence" });
    }
    return { command: entry.command, claims: entry.claims };
  });

  return { skill, teaches, concept, triggers, regions, notCovered, credentials, evidence };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/skill-manifest.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/skill-manifest.mjs tests/skill-manifest.test.mjs
git commit -m "feat(manifest): validate skill.json against the example contract schema"
```

---

### Task 3: Structural contract rules

**Files:**
- Create: `lib/example-contract.mjs`
- Create: `tests/_fixture.mjs`
- Test: `tests/example-contract.test.mjs`

**Interfaces:**
- Consumes: `parseManifest` from `lib/skill-manifest.mjs`.
- Produces: `checkExample(dir: string) => Violation[]` where `Violation` is `{ rule: string, message: string }`; `CATEGORIES: readonly string[]`.

An empty array means the example is conformant. The function reports every violation it can find rather than throwing on the first, so one run tells an author everything to fix.

- [ ] **Step 1: Write the failing test**

Create `tests/_fixture.mjs`:

```js
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MANIFEST = {
  skill: "theokit-memory",
  teaches: ["@theokit/sdk/memory"],
  concept: "Memory that persists across agent runs",
  triggers: ["memory"],
  regions: [{ id: "create-agent-with-memory", explains: "Enabling memory" }],
  notCovered: ["external adapters"],
  credentials: ["ANTHROPIC_API_KEY"],
};

const PACKAGE = {
  name: "theokit-example-memory",
  private: true,
  type: "module",
  scripts: { start: "tsx src/cli.ts", typecheck: "tsc --noEmit" },
  dependencies: { "@theokit/sdk": "4.61.0" },
};

const SOURCE = [
  "// #region skill:create-agent-with-memory",
  "const agent = await Agent.create({ memory: { enabled: true } });",
  "// #endregion",
].join("\n");

/**
 * Write a conformant example into a temp directory, then apply `mutate` to break exactly one rule.
 * Each test asserts one violation, so a fixture that starts conformant keeps every assertion
 * about the rule under test rather than about fixture drift.
 */
export function makeExample(mutate = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "theokit-example-"));
  const dir = join(root, "capabilities", "memory");
  mkdirSync(join(dir, "src"), { recursive: true });

  const files = {
    "skill.json": JSON.stringify(MANIFEST, null, 2),
    "package.json": JSON.stringify(PACKAGE, null, 2),
    "package-lock.json": JSON.stringify({ lockfileVersion: 3 }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }, null, 2),
    "README.md": "# memory\n\nNeeds ANTHROPIC_API_KEY.\n",
    ".gitignore": "node_modules/\ndist/\n",
    "src/cli.ts": SOURCE,
  };

  mutate(files);

  for (const [name, content] of Object.entries(files)) {
    if (content === null) continue;
    writeFileSync(join(dir, name), content);
  }

  return dir;
}
```

Create `tests/example-contract.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

import { checkExample } from "../lib/example-contract.mjs";
import { makeExample } from "./_fixture.mjs";

function rules(dir) {
  return checkExample(dir).map((violation) => violation.rule);
}

test("a conformant example reports no violations", () => {
  assert.deepEqual(checkExample(makeExample()), []);
});

test("a missing README is reported, because the repository promises each example names its credentials", () => {
  assert.ok(rules(makeExample((files) => { files["README.md"] = null; })).includes("required-files"));
});

test("a ranged @theokit dependency is reported", () => {
  const dir = makeExample((files) => {
    files["package.json"] = JSON.stringify({
      name: "theokit-example-memory",
      private: true,
      type: "module",
      scripts: { start: "tsx src/cli.ts", typecheck: "tsc --noEmit" },
      dependencies: { "@theokit/sdk": "^4.61.0" },
    });
  });

  assert.ok(rules(dir).includes("exact-pin"));
});

test("a @theokit dependency resolved through a local path is reported", () => {
  const dir = makeExample((files) => {
    files["package.json"] = JSON.stringify({
      name: "theokit-example-memory",
      private: true,
      type: "module",
      scripts: { start: "tsx src/cli.ts", typecheck: "tsc --noEmit" },
      dependencies: { "@theokit/sdk": "file:../../../theokit-sdk/packages/sdk" },
    });
  });

  assert.ok(rules(dir).includes("exact-pin"));
});

test("a package name that does not match the directory slug is reported", () => {
  const dir = makeExample((files) => {
    const pkg = JSON.parse(files["package.json"]);
    pkg.name = "theokit-example-something-else";
    files["package.json"] = JSON.stringify(pkg);
  });

  assert.ok(rules(dir).includes("package-name"));
});

test("a tsconfig without strict is reported", () => {
  const dir = makeExample((files) => {
    files["tsconfig.json"] = JSON.stringify({ compilerOptions: { strict: false } });
  });

  assert.ok(rules(dir).includes("strict-typescript"));
});

test("a missing typecheck script is reported", () => {
  const dir = makeExample((files) => {
    const pkg = JSON.parse(files["package.json"]);
    delete pkg.scripts.typecheck;
    files["package.json"] = JSON.stringify(pkg);
  });

  assert.ok(rules(dir).includes("required-scripts"));
});

test("a manifest that fails its schema is reported as one violation, not a crash", () => {
  const dir = makeExample((files) => {
    files["skill.json"] = JSON.stringify({ skill: "memory" });
  });

  assert.ok(rules(dir).includes("manifest"));
});

test("a directory outside the category vocabulary is reported", () => {
  const dir = makeExample();
  const moved = join(dirname(dirname(dir)), "misc", "memory");
  mkdirSync(dirname(moved), { recursive: true });
  renameSync(dir, moved);

  assert.ok(rules(moved).includes("category"));
});

test("a @theokit devDependency with a range is reported too", () => {
  const dir = makeExample((files) => {
    const pkg = JSON.parse(files["package.json"]);
    pkg.devDependencies = { "@theokit/sdk-tools": "^0.27.0" };
    files["package.json"] = JSON.stringify(pkg);
  });

  assert.ok(rules(dir).includes("exact-pin"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/example-contract.test.mjs`
Expected: FAIL — `Cannot find module '../lib/example-contract.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `lib/example-contract.mjs`:

```js
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { ManifestError, parseManifest } from "./skill-manifest.mjs";

/** Taken from the map in the theokit-examples README. A closed vocabulary, deliberately. */
export const CATEGORIES = Object.freeze([
  "build-agents",
  "capabilities",
  "connections",
  "extensibility",
  "component-libraries",
  "backend-di",
  "framework-plugins",
]);

const REQUIRED_FILES = [
  "skill.json",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "README.md",
  ".gitignore",
];

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Report every way `dir` departs from the example contract.
 *
 * Returns a list rather than throwing on the first problem: an author fixing an example should
 * learn everything that is wrong in one run, not one thing per run.
 */
export function checkExample(dir) {
  const violations = [];
  const add = (rule, message) => violations.push({ rule, message });

  for (const name of REQUIRED_FILES) {
    if (!existsSync(join(dir, name))) add("required-files", `missing ${name}`);
  }

  const slug = basename(dir);
  const category = basename(dirname(dir));
  if (!CATEGORIES.includes(category)) {
    add("category", `"${category}" is not one of: ${CATEGORIES.join(", ")}`);
  }

  let manifest = null;
  if (existsSync(join(dir, "skill.json"))) {
    try {
      manifest = parseManifest(readJson(join(dir, "skill.json")), join(dir, "skill.json"));
      if (manifest.skill !== `theokit-${slug}`) {
        add("manifest", `skill "${manifest.skill}" does not match directory slug "${slug}"`);
      }
    } catch (error) {
      if (!(error instanceof ManifestError)) throw error;
      add("manifest", error.message);
    }
  }

  if (existsSync(join(dir, "package.json"))) {
    const pkg = readJson(join(dir, "package.json"));

    if (pkg.name !== `theokit-example-${slug}`) {
      add("package-name", `name must be "theokit-example-${slug}", found "${pkg.name}"`);
    }
    if (pkg.private !== true) add("package-fields", 'must set "private": true');
    if (pkg.type !== "module") add("package-fields", 'must set "type": "module"');

    for (const script of ["start", "typecheck"]) {
      if (typeof pkg.scripts?.[script] !== "string") {
        add("required-scripts", `missing "${script}" script`);
      }
    }

    const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const [name, range] of Object.entries(declared)) {
      if (!name.startsWith("@theokit/")) continue;
      if (!EXACT_VERSION.test(range)) {
        add("exact-pin", `${name} must be pinned exactly, found "${range}"`);
      }
    }
  }

  if (existsSync(join(dir, "tsconfig.json"))) {
    const tsconfig = readJson(join(dir, "tsconfig.json"));
    if (tsconfig.compilerOptions?.strict !== true) {
      add("strict-typescript", 'tsconfig.json must set "strict": true');
    }
  }

  if (existsSync(join(dir, ".gitignore"))) {
    const ignored = readFileSync(join(dir, ".gitignore"), "utf8");
    for (const entry of ["node_modules/", "dist/"]) {
      if (!ignored.includes(entry)) add("gitignore", `must ignore ${entry}`);
    }
  }

  return violations;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/example-contract.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/example-contract.mjs tests/_fixture.mjs tests/example-contract.test.mjs
git commit -m "feat(contract): check the structural half of the example contract"
```

---

### Task 4: Region cross-checks

**Files:**
- Modify: `lib/example-contract.mjs`
- Test: `tests/example-contract.test.mjs`

**Interfaces:**
- Consumes: `parseRegions`, `RegionError` from `lib/regions.mjs`; the `checkExample` from Task 3.
- Produces: no new export. `checkExample` gains the rules `region-undeclared`, `region-missing`, `region-duplicate`, `region-location`, `region-syntax`.

Both directions are checked, because a slip in either one is silent otherwise: an id declared and never written produces a skill with a hole, and a region written and never declared produces code nobody will ever publish.

- [ ] **Step 1: Write the failing test**

Append to `tests/example-contract.test.mjs`:

```js
test("a manifest id with no matching region in the code is reported", () => {
  const dir = makeExample((files) => {
    const manifest = JSON.parse(files["skill.json"]);
    manifest.regions.push({ id: "never-written", explains: "x" });
    files["skill.json"] = JSON.stringify(manifest);
  });

  assert.ok(rules(dir).includes("region-missing"));
});

test("a region in the code with no manifest entry is reported", () => {
  const dir = makeExample((files) => {
    files["src/cli.ts"] += "\n// #region skill:undeclared\nconst a = 1;\n// #endregion\n";
  });

  assert.ok(rules(dir).includes("region-undeclared"));
});

test("the same region id in two files is reported", () => {
  const dir = makeExample((files) => {
    files["src/other.ts"] = files["src/cli.ts"];
  });

  assert.ok(rules(dir).includes("region-duplicate"));
});

test("a region outside src/ is reported", () => {
  const dir = makeExample((files) => {
    files["helper.ts"] = files["src/cli.ts"];
  });

  assert.ok(rules(dir).includes("region-location"));
});

test("an unclosed region is reported as a violation, not thrown", () => {
  const dir = makeExample((files) => {
    files["src/cli.ts"] = "// #region skill:create-agent-with-memory\nconst a = 1;\n";
  });

  assert.ok(rules(dir).includes("region-syntax"));
});
```

No fixture change is needed: `makeExample` already creates `src/` and writes every key it is given, so `src/other.ts` and `helper.ts` land where these tests expect them.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/example-contract.test.mjs`
Expected: FAIL — the five new tests find none of the new rules.

- [ ] **Step 3: Write the implementation**

Add to the head of `lib/example-contract.mjs`:

```js
import { readdirSync, statSync } from "node:fs";
import { relative } from "node:path";

import { parseRegions, RegionError } from "./regions.mjs";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx"]);

function sourceFiles(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (SOURCE_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) found.push(path);
    }
  };
  walk(dir);
  return found;
}
```

Insert before `return violations;` in `checkExample`:

```js
  const seen = new Map();
  for (const path of sourceFiles(dir)) {
    const relativePath = relative(dir, path).split("\\").join("/");
    let parsed;
    try {
      parsed = parseRegions(readFileSync(path, "utf8"), relativePath);
    } catch (error) {
      if (!(error instanceof RegionError)) throw error;
      add("region-syntax", error.message);
      continue;
    }

    for (const region of parsed) {
      if (!relativePath.startsWith("src/")) {
        add("region-location", `region "${region.id}" is in ${relativePath}; regions live under src/`);
      }
      const previous = seen.get(region.id);
      if (previous !== undefined) {
        add("region-duplicate", `region "${region.id}" appears in ${previous} and ${relativePath}`);
      } else {
        seen.set(region.id, relativePath);
      }
    }
  }

  if (manifest !== null) {
    for (const region of manifest.regions) {
      if (!seen.has(region.id)) {
        add("region-missing", `skill.json declares "${region.id}", which no source file opens`);
      }
    }
    const declared = new Set(manifest.regions.map((region) => region.id));
    for (const [id, file] of seen) {
      if (!declared.has(id)) {
        add("region-undeclared", `${file} opens "${id}", which skill.json does not declare`);
      }
    }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/example-contract.test.mjs`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/example-contract.mjs tests/_fixture.mjs tests/example-contract.test.mjs
git commit -m "feat(contract): cross-check regions against the manifest in both directions"
```

---

### Task 5: The CLI

**Files:**
- Create: `bin/check-example.mjs`
- Modify: `package.json` (add the `theokit-check-example` bin entry)
- Test: `tests/check-example.test.mjs`

**Interfaces:**
- Consumes: `checkExample` from `lib/example-contract.mjs`.
- Produces: a CLI. `theokit-check-example <root>` walks the tree, treats any directory containing `skill.json` as an example, prints violations grouped by example, exits 1 if any exist and 0 otherwise. A root containing no example at all exits 1 and says so, because silence over an empty set is the worst output a checker can give.

- [ ] **Step 1: Write the failing test**

Create `tests/check-example.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { makeExample } from "./_fixture.mjs";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "check-example.mjs");

function run(root) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [CLI, root], { encoding: "utf8" }) };
  } catch (error) {
    return { code: error.status, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

test("exits 0 and names the example it checked", () => {
  const root = resolve(makeExample(), "..", "..");
  const { code, out } = run(root);

  assert.equal(code, 0);
  assert.match(out, /capabilities\/memory/);
});

test("exits 1 and names the rule when an example is malformed", () => {
  const root = resolve(makeExample((files) => { files["README.md"] = null; }), "..", "..");
  const { code, out } = run(root);

  assert.equal(code, 1);
  assert.match(out, /required-files/);
  assert.match(out, /README\.md/);
});

test("exits 1 when the tree contains no example, rather than reporting success over nothing", () => {
  const { code, out } = run(mkdtempSync(join(tmpdir(), "theokit-empty-")));

  assert.equal(code, 1);
  assert.match(out, /no example/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/check-example.test.mjs`
Expected: FAIL — the CLI file does not exist.

- [ ] **Step 3: Write the implementation**

Create `bin/check-example.mjs`:

```js
#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { checkExample } from "../lib/example-contract.mjs";

/** An example is any directory holding a skill.json. That is the whole discovery rule. */
function findExamples(root) {
  const found = [];
  const walk = (current) => {
    if (existsSync(join(current, "skill.json"))) {
      found.push(current);
      return;
    }
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
    }
  };
  walk(root);
  return found.sort();
}

const root = resolve(process.argv[2] ?? ".");
const examples = findExamples(root);

if (examples.length === 0) {
  console.error(`no example found under ${root} (an example is a directory containing skill.json)`);
  process.exit(1);
}

let failed = 0;
for (const dir of examples) {
  const name = relative(root, dir).split("\\").join("/");
  const violations = checkExample(dir);

  if (violations.length === 0) {
    console.log(`ok   ${name}`);
    continue;
  }

  failed += 1;
  console.log(`FAIL ${name}`);
  for (const violation of violations) {
    console.log(`       ${violation.rule}: ${violation.message}`);
  }
}

process.exit(failed === 0 ? 0 : 1);
```

Add to `package.json`, replacing the `bin` block:

```json
  "bin": {
    "theokit-skills": "./bin/install.mjs",
    "theokit-check-example": "./bin/check-example.mjs"
  },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/check-example.test.mjs`
Expected: PASS, 3 tests.

Then run the whole suite: `npm test`
Expected: PASS, 32 tests across four files.

- [ ] **Step 5: Commit**

```bash
git add bin/check-example.mjs tests/check-example.test.mjs package.json
git commit -m "feat(cli): check every example in a tree and fail on the first malformed one"
```

---

### Task 6: The written contract and the missing README

**Files:**
- Create: `<theokit-examples>/EXAMPLE-CONTRACT.md`
- Create: `<theokit-examples>/package.json`
- Create: `<theokit-examples>/capabilities/memory/README.md`

**Interfaces:**
- Consumes: the rule names emitted by `checkExample` — `required-files`, `category`, `manifest`, `package-name`, `package-fields`, `required-scripts`, `exact-pin`, `strict-typescript`, `gitignore`, `region-syntax`, `region-location`, `region-duplicate`, `region-missing`, `region-undeclared`.
- Produces: the human-readable contract each rule enforces.

`EXAMPLE-CONTRACT.md` documents every rule above under the rule's own name, so a failure message leads straight to the paragraph explaining it. Content comes from section 6 of the spec; do not invent rules the checker does not enforce, and do not omit rules it does.

The root `package.json` is private, `type: module`, and carries one script:

```json
{
  "name": "theokit-examples",
  "private": true,
  "type": "module",
  "scripts": {
    "check": "node ../theokit-skills/bin/check-example.mjs ."
  }
}
```

The relative path is a development convenience and is documented as such in `EXAMPLE-CONTRACT.md`: CI wiring waits for `@theokit/skills` to be published with the checker, which cannot happen while `skills/` is empty. Do not add a CI workflow in this task — a workflow that cannot pass is worse than one that does not exist.

`capabilities/memory/README.md` must state that the example needs a provider credential, name `THEOKIT_MODEL` and its default `openai-chatgpt/gpt-5.4-mini`, name `THEOKIT_PROJECT_DIR` and its default `./workspace`, and list the four commands `cli.ts` accepts: `learn`, `ask`, `demo:poisoned`, `verify:permissions`. All four are read from `capabilities/memory/src/cli.ts`; do not describe behavior that file does not have.

- [ ] **Step 1: Initialise the repository if it has no commit**

Run in `theokit-examples`: `git log --oneline -1`
If it fails with "does not have any commits yet", the first commit in Step 4 is the initial commit. Confirm the branch is `workspace`: `git branch --show-current`.

- [ ] **Step 2: Write the three files**

Follow the content requirements above. Everything in English.

- [ ] **Step 3: Verify the README claims match the code**

Run: `grep -n 'THEOKIT_MODEL\|THEOKIT_PROJECT_DIR\|demo:poisoned\|verify:permissions' capabilities/memory/src/cli.ts`
Expected: every name the README mentions appears in the output. Anything in the README that is absent here is a claim the code does not support — delete it.

- [ ] **Step 4: Commit**

```bash
git add EXAMPLE-CONTRACT.md package.json capabilities/memory/README.md
git commit -m "docs: the example contract, and the credentials the memory example needs"
```

---

### Task 7: Bring `capabilities/memory` up to the contract

**Files:**
- Create: `<theokit-examples>/capabilities/memory/skill.json`
- Modify: `<theokit-examples>/capabilities/memory/src/assistant.ts`

**Interfaces:**
- Consumes: the schema from Task 2 and the rules from Tasks 3 and 4.
- Produces: the first conformant example, which is the input every later plan builds on.

Two regions, both in `assistant.ts`, both opened **above** the doc comment so the comment travels with the code — that prose is the reason the verbatim rule exists:

- `create-agent-with-memory` wraps the `AssistantOptions` doc comment through the end of `createAssistant`. It carries the note that `PermissionEngine` takes its rules positionally and that the object form builds an engine with no usable rule list.
- `ask-and-wait` wraps the `ask` doc comment through the end of `ask`. It carries the note that `send()` returns a handle whose `result` is empty and that the answer arrives from `wait()`.

`skill.json`:

```json
{
  "skill": "theokit-memory",
  "teaches": ["@theokit/sdk"],
  "concept": "An agent that remembers what it learns between separate runs, in markdown files on disk",
  "triggers": ["memory", "remember between sessions", "MEMORY.md", "persist what the agent learns"],
  "regions": [
    {
      "id": "create-agent-with-memory",
      "explains": "Turning memory on, and why the permission layer is registered by default"
    },
    {
      "id": "ask-and-wait",
      "explains": "Sending a message and waiting for the run to finish, which are two calls"
    }
  ],
  "notCovered": [
    "external memory adapters: mem0, honcho, supermemory",
    "sharing one memory store between several agents",
    "pruning or expiring what was remembered"
  ],
  "credentials": ["a provider credential for THEOKIT_MODEL"],
  "evidence": [
    {
      "command": "npm start -- demo:poisoned",
      "claims": "A planted memory entry phrased as standing policy drove the action it described in 2 of 6 runs without the permission layer, and 0 of 6 with it."
    },
    {
      "command": "npm start -- verify:permissions",
      "claims": "An engine constructed with an empty rule array blocks every tool call, so the protection is the engine being present rather than a rule written in advance."
    }
  ]
}
```

`teaches` is `@theokit/sdk` rather than a subpath because memory is configured through the root export (`Agent.create({ memory: { enabled: true } })`), which `src/assistant.ts` imports directly. Verify this before writing: `grep -n '@theokit/sdk' capabilities/memory/src/assistant.ts`.

- [ ] **Step 1: Add the region markers**

Insert `// #region skill:create-agent-with-memory` above the `/**` that opens the `AssistantOptions` doc comment, and `// #endregion` after the closing brace of `createAssistant`. Insert `// #region skill:ask-and-wait` above the `/**` that opens the `ask` doc comment, and `// #endregion` after the closing brace of `ask`.

- [ ] **Step 2: Write `skill.json`**

Use the content above verbatim.

- [ ] **Step 3: Run the checker and verify it passes**

Run in `theokit-examples`: `npm run check`
Expected: `ok   capabilities/memory`, exit 0.

- [ ] **Step 4: Verify the example still typechecks**

Run in `capabilities/memory`: `npm install && npm run typecheck`
Expected: no errors. Region markers are comments and must not change behavior; if this fails, a marker landed inside an expression.

- [ ] **Step 5: Verify the smoke path still works**

Run in `capabilities/memory`: `npm start`
Expected: the usage text prints and the process exits 0, with no credential set.

- [ ] **Step 6: Commit**

```bash
git add capabilities/memory/skill.json capabilities/memory/src/assistant.ts
git commit -m "feat(memory): declare the skill manifest and mark the teaching regions"
```

---

## Spec requirements this plan deliberately leaves to another layer

Two rules in section 6 of the spec cannot be enforced by a static checker, and pretending otherwise
would leave a rule that reports green because it never ran:

- **6.5, `npm start` exits 0 with no arguments.** Running it needs `npm install` and a real
  toolchain, so it belongs in CI rather than in `checkExample`. Task 7 Step 5 verifies it by hand
  for the one example that exists; it becomes automatic when CI is wired in the release plan.
- **6.7, everything in English.** This is the language lint deleted by commit `9c2e340`. It is listed
  in the distribution plan rather than here, because it must cover the generated corpus as well as
  the examples, and the corpus does not exist yet.

## What this plan does not do

- **No `CHANGELOG.md` entry.** Nothing here changes behavior for anyone consuming `@theokit/skills@0.9.2`. Entries land in the plan that ships the release.
- **No CI workflow in `theokit-examples`.** It depends on a published checker, and publishing is blocked while `skills/` is empty.
- **No npm publish.**
- **No generator, no gates, no installer change.** Those are the next two plans, and neither can be tested before Task 7 lands.

## Next plans

1. **Generator** — region extraction, typedoc over the pinned `.d.ts`, the `@theokit/sdk` agent that writes prose only, gates G1-G3, `.provenance.json`.
2. **Distribution and release** — lockfile-derived selection, namespace ownership, version-divergence reporting, removal of `install-mode.mjs`, `manifest.mjs` and `--check`, the language lint, then the release that unblocks CI in `theokit-examples`.
