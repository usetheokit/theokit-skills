# Redesigning @theokit/skills — skills generated from examples that run

Date: 2026-08-28
Status: approved, pending implementation plan
Repositories affected: `theokit-skills`, `theokit-examples`

## 1. Context

`@theokit/skills@0.9.2` is published on npm. It installs a hand-written corpus of skills into
`.agents/skills/`, `.claude/skills/` and `.github/skills/`, choosing between a symlink and a copy,
writing a manifest, and offering `--check` to detect divergence.

Commit `9c2e340` emptied the repository: it deleted the 32 `skills/*/SKILL.md` files, the 18 test
files and `stryker.config.json`. The installer is what remains. This document describes what is
built in its place.

## 2. Diagnosis

Three problems, ordered by the damage they cause:

**Skills were written by hand and had no way to prove they were right.** The `CHANGELOG` records two
cases: one example taught `await using`, which requires Node 24 while the package declares
`>=22.12.0`; another imported `zod` without stating the major, in a package that depends on `zod@^4`.
In both cases the example was plausible and did not work. Nothing in the process told those two
things apart.

**Distribution was monolithic.** Installing 55 skills into a project that uses two packages fills the
agent's context with 53 irrelevant ones.

**Maintenance managed a problem the architecture created.** The manifest, drift detection, `--check`,
`taught-coverage`, `plan-fingerprint` and mutation testing all existed because an installed skill was
a copy with a life of its own, free to diverge from what the package actually exposes.

## 3. Goal

A coding agent — Claude Code, Codex, Gemini CLI, Copilot, Zed — must be able to write correct code
against any package in the theokit ecosystem **without consulting the web**. Everything it needs is
in the installed skill: the public API surface at the version it has, examples that provably run, and
an explicit statement of what the skill does not cover.

### Success criteria

1. No line of code published in a skill was written by an LLM.
2. No API signature published in a skill was written by an LLM.
3. A project receives only the skills for the `@theokit/*` packages it actually uses.
4. A skill that has fallen behind its source is detected without spending a token.
5. Installing requires no decisions: no mode, no manifest, no reconciliation.

## 4. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | The API surface comes from the published packages' `.d.ts` | It is what the user receives, and it requires configuring nothing across the ~55 packages. |
| D2 | Examples come from `theokit-examples`, extracted verbatim | It is the only place that executes the code, and therefore the only one that can claim it runs. |
| D3 | The LLM produces **prose only** | Every step where an LLM produces code or a signature carries the chance of producing one that does not work. |
| D4 | A skill exists only where a runnable example exists | Project owner's decision. Accepted consequence: the corpus ships with 1 skill. |
| D5 | Installation derives from the user's lockfile, always by copy | Granularity without 55 npm packages; eliminates divergence rather than policing it. |
| D6 | Generation runs locally; CI watches without an LLM | LLM cost is the same anywhere; what drives it up is frequency. CI only warns. |
| D7 | The generator is a `@theokit/sdk` agent | Dogfooding: an SDK regression surfaces here before it reaches a user. |
| D8 | Git history is preserved | `0.9.2` is already published with provenance; deleting commits does not delete the package, only the record of why it changed. |

## 5. Architecture

### 5.1 Division of responsibility

| Part | Produces | Why this part and not another |
|---|---|---|
| `theokit-examples` and its CI | The example code, verbatim | It is the only one that executes |
| `.d.ts` of the pinned package version | The public API surface | It is what you publish |
| `@theokit/sdk` agent | The prose: what, when, why, pitfalls | It is where types and tests are silent |

### 5.2 The contract between the repositories

The coupling between `theokit-examples` and `theokit-skills` is exactly two artifacts.

**`skill.json`**, at the root of each example:

```jsonc
{
  "skill": "theokit-memory",
  "teaches": ["@theokit/sdk/memory"],
  "concept": "Memory that persists across agent runs",
  "triggers": ["memory", "remember across sessions", "MEMORY.md"],
  "regions": [
    { "id": "create-agent-with-memory", "explains": "Enabling memory when creating the agent" },
    { "id": "query-memory",             "explains": "Reading back what was remembered" }
  ],
  "notCovered": ["external adapters: mem0, honcho, supermemory"],
  "credentials": ["ANTHROPIC_API_KEY"],
  "evidence": [
    {
      "command": "npm start -- demo:poisoned",
      "claims": "A planted memory entry drove the action in 2 of 6 runs without the permission layer, 0 of 6 with it."
    }
  ]
}
```

`regions` is ordered: array order is teaching order. `teaches` names export subpaths where a
capability lives on one, and the package root where it lives on the root export — what matters is
that the entry names the narrowest export that actually carries the capability, because that is
what keeps `references/api.md` scoped.
`notCovered` is required — the `theokit-examples` README already demands that an example state what
the capability does not give you, and that section is what stops the agent from answering beyond the
evidence.

**Regions**, in the files CI executes:

```ts
// #region skill:create-agent-with-memory
const agent = await Agent.create({ /* ... */ });
// #endregion
```

The extractor walks the example's `src/`. A duplicate id, an id declared in the manifest but absent
from the code, or a region in the code with no manifest entry are hard errors. There is no field
pointing at a file: moving code between files should break nothing, and the three checks above
already make any slip loud.

### 5.3 Anatomy of a generated skill

```
skills/theokit-memory/
  SKILL.md                 # short, always loaded
  references/
    api.md                 # public surface of the subpath, extracted from the .d.ts
    example.md             # every file under the example's src/, verbatim
  .provenance.json
```

This follows Agent Skills progressive disclosure: `SKILL.md` enters context when the skill triggers;
`references/` only when the agent needs it. `example.md` exists because the regions in `SKILL.md`
show the point, and an agent that needs the whole file — imports, setup, fixtures — must find it
rather than invent it.

`SKILL.md` carries: triggers, the concept, the region blocks with the prose explaining them, what the
skill does **not** cover, the credentials required, and the exact version it teaches.

**`.provenance.json`** is what makes gate G4 possible:

```jsonc
{
  "generatedAt": "2026-08-28T12:00:00Z",
  "generator": { "sdk": "@theokit/sdk@4.61.0", "model": "<model id>" },
  "source": { "repo": "theokit-examples", "path": "capabilities/memory", "commit": "<sha>" },
  "teaches": [{ "package": "@theokit/sdk", "version": "4.61.0", "subpath": "./memory" }],
  "inputHashes": {
    "manifest": "sha256:...",
    "api":      "sha256:...",
    "regions":  { "create-agent-with-memory": "sha256:..." }
  }
}
```

### 5.4 Generation pipeline

```
capabilities/<x>/{skill.json, src/*.ts, package.json}
      │
      ├─[1] extract regions ───────────────────► VERBATIM code
      ├─[2] typedoc over the installed .d.ts ──► references/api.md
      │
      └─[3] @theokit/sdk agent ────────────────► PROSE
                  │
           [4] assemble SKILL.md = prose + verbatim blocks
           [5] gates G1–G3
           [6] write .provenance.json
```

**Step 2.** typedoc is pointed at the `.d.ts` of the package installed in the example's
`node_modules`, at the version its `package.json` pins. It is configured once in this repository; not
one of the ~55 packages has to change. `tsc` preserves TSDoc in declaration files, so every comment
the projects already write lands in `api.md` for free — the more they document, the richer the
reference, with no change to this pipeline.

**Step 3.** The agent receives `api.md`, the regions and the manifest, and returns text whose code
blocks are immutable placeholders. It cannot write code because there is nowhere to put it.

**Incremental.** A skill is regenerated only when one of its `inputHashes` changes. A full rebuild is
explicit (`--all`).

### 5.5 Gates

All deterministic; none consume an LLM.

| Gate | Proves | When |
|---|---|---|
| **G1** | Every code block in `SKILL.md` is byte-identical to its source region | generation |
| **G2** | Every inline-code identifier in the prose appears in `references/api.md` | generation |
| **G3** | The manifest's `notCovered` is present in the skill | generation |
| **G4** | The `.provenance.json` hashes match the current inputs | CI, every push |

G2 reads the identifiers the prose marks as inline code (in backticks) and requires each one to be
present in the shipped reference. It compares the skill against the reference it ships itself, not
against an external source: prose citing something absent from the shipped reference is useless to
the agent even when the symbol exists under another subpath.

When G4 fails, the message names the cause: `theokit-memory is out of date: @theokit/sdk moved from
4.61.0 to 4.62.0 — run npm run generate`.

"The example runs" is not a gate in this repository. That is `theokit-examples`' CI, and duplicating
it would fake a second proof.

### 5.6 Distribution

```
npx @theokit/skills             # installs skills for the @theokit/* packages in the project
npx @theokit/skills --all       # installs the whole corpus
npx @theokit/skills --dry-run   # shows what it would do
```

The command reads the project's `package.json` and lockfile, resolves which `@theokit/*` packages are
installed and at what version, selects the matching skills, and writes them — always by copy — into
the targets of the detected tools: `.agents/skills/`, `.claude/skills/`, `.github/skills/`. The
current target registry (`lib/targets.mjs`) is kept; nothing in it was wrong.

Two details make the absence of a manifest work:

**Namespace ownership.** Everything we write is named `theokit-*`. That is how a re-run removes the
skill for an uninstalled package, without a file remembering what was installed.

**Version divergence stated at the time.** A skill declares the version it teaches. If the project has
`4.62.0` and the corpus teaches `4.61.0`, the install output says so explicitly. Installing beats not
installing; staying silent does not. That information, delivered at install time, is what replaces
`--check`.

## 6. The example contract (`theokit-examples`)

The generator can only be simple if the examples are uniform. Fifty examples in fifty shapes would
turn the extractor into a pile of special cases, and every special case is a chance to extract the
wrong thing quietly. Rigidity here is what buys a dumb generator, and a dumb generator is the one
that cannot surprise you.

This contract lives in `theokit-examples/EXAMPLE-CONTRACT.md` with a script that checks it in that
repository's CI, so a malformed example breaks where it was written rather than at generation time,
days later.

### 6.1 Discovery

An example is any directory containing a `skill.json`. That is the whole rule; nothing else is an
example.

### 6.2 Location

`<category>/<slug>/`, where `category` comes from a closed vocabulary taken from the repository's
README map: `build-agents`, `capabilities`, `connections`, `extensibility`, `component-libraries`,
`backend-di`, `framework-plugins`. `slug` is `skill.json.skill` without its `theokit-` prefix.

### 6.3 Required files

| File | Checked requirement |
|---|---|
| `skill.json` | validates against the schema in 5.2 |
| `package.json` | `private: true`, `type: "module"`, name `theokit-example-<slug>`, `start` and `typecheck` scripts, and every `@theokit/*` dependency pinned exactly (`4.61.0` — never `^`, `~` or `latest`) |
| `package-lock.json` | committed, so the run is reproducible |
| `tsconfig.json` | `strict: true` |
| `README.md` | present, and states the credentials the example needs |
| `src/` | at least one file; regions live only here |
| `.gitignore` | ignores `node_modules/` and `dist/` |

### 6.4 Regions carry prose, not just code

Everything inside a region is copied verbatim — **comments included**. This is not a detail; it is
where the most valuable content in the repository lives.

The `capabilities/memory` example already documents, at the point of use, that `agent.send()` returns
a handle rather than a result and that reading text off it prints nothing while the memory file is
written correctly; that `PermissionEngine` takes its rules positionally, so the object form
typechecks nowhere and silently builds an engine with no usable rule list; and that a planted memory
entry drove the action it described in 2 of 6 runs without the permission layer and 0 of 6 with it.

None of that is derivable from a type signature. A model asked to produce it would produce something
weaker and equally confident. So the pipeline must carry it rather than restate it: the author
decides where the region opens, and if it opens above the doc comment, the doc comment travels with
the code. The LLM writes only the connective prose between blocks.

Region rules, all checked:

- Markers are `// #region skill:<id>` and `// #endregion`.
- `<id>` is kebab-case and unique within the example.
- Regions live under `src/`, never nest, and never span files.
- Every id in `skill.json.regions` exists in the code, **and** every region in the code is declared
  in the manifest. Both directions, because a slip in either one is silent otherwise.
- Array order in `skill.json.regions` is the teaching order.

### 6.5 Runnability

`npm start` with no arguments prints usage and exits 0. That gives CI a smoke test needing no
credential, and the existing `memory` CLI already behaves this way. The full path runs wherever a
credential is available, declared in `skill.json.credentials` and documented in the example's README.

The driver file — the CLI or entrypoint named by the `start` script — is never extracted into regions.
It ships whole in `references/example.md`, so an agent that needs it finds it instead of inventing it.

### 6.6 Evidence commands

An example may ship commands that prove the claims its prose makes, and `memory` already does:
`demo:poisoned` and `verify:permissions`. Declared in the manifest, they let the generated skill point
an agent at a check rather than ask it to take a sentence on trust.

```jsonc
"evidence": [
  {
    "command": "npm start -- demo:poisoned",
    "claims": "A planted memory entry drove the action in 2 of 6 runs without the permission layer, 0 of 6 with it."
  }
]
```

### 6.7 Forbidden

- A range or `latest` on any `@theokit/*` dependency.
- Resolving theokit through a workspace or a local checkout. The repository exists outside the SDK
  precisely so that it cannot cheat; an example that resolves through a workspace tests the
  repository it lives in, not the experience of someone who typed `npm install`.
- Regions that nest or span files.
- Any text in a language other than English.

### 6.8 Bringing `capabilities/memory` up to the contract

It is the only runnable example and the source of the first skill, so it is also the contract's first
test: a standard its only subject fails is a document nobody follows.

It already satisfies the structural half — exact pin on `@theokit/sdk@4.61.0`, `strict` tsconfig,
committed lockfile, correct package name, `start` and `typecheck` scripts, `.gitignore`. Three things
are missing: `skill.json`, the region markers, and its own `README.md`. That last one is a promise
already outstanding — the repository README states that each example says which credentials it needs,
and this example has nowhere to say it.

`theokit-examples` has no initial commit on `workspace` yet, so this lands with it.

## 7. What is removed

| Removed | Why |
|---|---|
| `lib/install-mode.mjs` | There is no link-vs-copy decision any more |
| `lib/manifest.mjs` | There is nothing to reconcile |
| The `--check` command | Replaced by G4 in the repository and by the version message at install time |
| `scripts/taught-coverage.mjs` | The corpus is derived; coverage becomes a consequence, not a measurement |
| `scripts/plan-fingerprint.mjs` | Same |
| Mutation testing (Stryker) | It policed machinery that ceases to exist |

## 8. Tests

They return, covering behavior rather than meta-machinery:

- **Gates**: each of the four, with a passing case and a failing case that names its reason.
- **Region extractor**: missing id, duplicate id, orphan region, nested region, region with no
  `#endregion`.
- **Dependency resolution**: a project with two `@theokit/*` packages gets two skills; a project with
  none gets zero and says so.
- **Namespace ownership**: re-running after removing a dependency deletes the matching skill and
  touches nothing outside `theokit-*`.
- **Version divergence**: the output names both versions.
- **Idempotent install**: running twice produces the same tree.
- **Example-contract checker**: each rule in section 6 rejects a fixture that breaks it, and the
  real `capabilities/memory` passes unmodified.

## 9. First delivery

The `theokit-memory` skill, end to end, from `capabilities/memory` — the one runnable example that
exists. It exercises the manifest, regions, API extraction, generation, all four gates and the
install. From the second skill onward the work is repetition.

## 10. Out of scope, and accepted risks

**Writing the ~49 missing examples.** `theokit-examples` maps ~50 capabilities and has 1 runnable.
Decision D4 means the corpus grows at the speed those examples get written, and that is a larger
project than this one. This design makes each conversion cheap; it does not do the conversions.

**Stated consequence of D4:** until those examples exist, an agent with no skill for a package will
consult the web. The goal in section 3 is met per package, not across the ecosystem, and only to the
extent that examples are added.

**No automatic `postinstall`.** Regenerating skills on every `npm install` would be the liveliest form
of distribution, but `postinstall` does not run under `npm ci --ignore-scripts` and is a supply-chain
vector teams block. The explicit command is the guaranteed path.

**The prose has no gate.** G1 through G3 prove the code runs and the symbols exist. None of them
proves the explanation is correct. That is why generation is local and you review before committing.
