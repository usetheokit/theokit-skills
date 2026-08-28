# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- A commit can now record which plan it was written against. Plans live in a directory this
  repository never versions, so a plan edited after the commit it governs used to be
  indistinguishable from one that was always right — measured once at 114 seconds after the fact,
  with every criterion passing and nothing able to tell a correction from a retrofit. The commit
  message is versioned even when the file is not, so it carries the plan's fingerprint;
  `scripts/plan-fingerprint.mjs` generates and checks it. `RELEASING.md` states what the mechanism
  does **not** prove: that the plan existed before the work. (B-009)

### Added

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [0.8.0] - 2026-08-28

### Added

- When an example fails to compile, the gate points at the line in the `SKILL.md` — it used to print
  a line number inside a virtual concatenated file that exists nowhere, sending whoever fixes it to
  count fenced blocks by hand. (B-003)

- The examples in three skills are now **compiled** against the installed packages, as a gate that
  can fail. Until now nothing read a code block's body: an example whose imports resolved but whose
  body called a removed method, passed a wrong argument, or simply did not typecheck, shipped green.
  The list is explicit and the run prints both halves — `3 skill(s) compiled, 28 not in the
  allowlist` — because a gate that does not say what it skipped is claiming coverage it has not
  earned. Skills join the list as they are fixed; a listed skill that stops compiling turns the suite
  red. (B-003)



### Changed

- Mutation testing runs the tests that can actually kill the mutants. Its runner re-executes a whole
  npm script for every mutant, and the script was the entire suite — measured at 36.0s against 5.6s
  for the four files that touch the mutated directories, so **84% of every run was spent on tests
  that could not kill a single mutant** because they exercise the skills corpus rather than the
  installer. A guard fails the suite if a test that does touch those directories is left out of the
  smaller script, since that would lower the score silently rather than loudly. (B-003)

- The TypeScript compiler the test suite uses lives in one place. It was embedded in the
  import-resolution gate, and the new example gate needed the same machinery — compiler options, an
  in-memory host, and the map from each installed package's declared subpaths to its built
  declarations. Two copies would have drifted apart exactly as the two import extractors did. (B-003)

## [0.7.0] - 2026-08-27

### Changed

- The README says what a skill is for. Measured: the skills teach 176 symbols across 29 subpaths
  while 545 exported symbols are taught by nothing — a ratio that looks alarming until you know a
  `SKILL.md` is always-loaded context, where every symbol costs tokens in every conversation whether
  or not it is needed. The gate runs in the other direction only, and that count is 0: nothing a
  skill teaches is missing from its package. The section states the limit too — nobody has measured
  which exports matter, and nothing proposes a new one for inclusion. (B-006)

- The README said the repository ships one skill. It ships 31.

- **`--check` now compares content.** It used to compare existence only, so an installed `SKILL.md`
  that had been edited passed as healthy — measured with a control: an intact install exits 0, a
  deleted skill directory exits 1, and an edited instruction file also exited **0**. The command the
  help text calls *"fail if what is installed drifted from this version (CI)"* detected a directory
  disappearing and nothing else. The comparison is over the whole skill directory, so a file under
  `references/` is covered by the same mechanism rather than a second one. (B-002)

- **`--check` stopped reporting drift about the machine it runs on.** Its expectation came from the
  *installation plan* — what an install would do here, derived from which tools are detected — rather
  than from the manifest, which records what was actually installed. So a bare `--check` after a
  `--target=agents` install exited 1 on any machine that also had `~/.claude`, for paths that were
  never installed. Anyone who trusted it in CI had to pass `--target` to make it pass, which silently
  narrowed what was checked. (B-002)

- The manifest schema is `2`. A manifest written by an older version is refused as `absent` rather
  than half-checked — its own contract has always been *"a bump means wipe and reinstall, never
  silently migrate"*, and treating a missing digest as "content unknown, skip the check" would have
  made the gate weakest exactly on the installs that predate the fix. One `npx @theokit/skills
  --force` after upgrading. (B-002)


### Fixed

- After a schema upgrade the failure message said "no manifest found — the skills were never
  installed here" while the file sat right there with 31 skills installed. It now describes both
  states it actually covers. (B-002)

- The CI smoke passed `--target=` flags to `--check`, which have been inert on that path since the
  check started reading the manifest — a line that read as if it scoped something. (B-002)

- The gate is now exercised through the binary a user actually runs, not only through the library
  function underneath it. Deleting content-drift detection outright used to leave every end-to-end
  test green — the unit suite caught it and the shipped surface did not. (B-002)

- **`--check` could report "up to date" over a tampered skill.** Installing for a second tool
  replaced the manifest instead of adding to it, and since the manifest became the sole expectation,
  the first tool's installation left the gate entirely. Reproduced: install for Codex, then for
  Claude Code, edit a file under `.agents/skills/` — the answer was `up to date — 31` and exit 0. The
  31 was true of the manifest and false of the tree. The manifest now merges by target and skill; a
  version change still replaces wholesale. (B-002)

- A manifest written on Windows reported every entry as missing when read on Linux. `relative()`
  produces backslashes, and POSIX path joining treats them as part of a filename — while the
  manifest is explicitly meant to be committed alongside the skills it describes, so reading it on
  another operating system is the normal case. (B-002)

- An unreadable file inside a skill directory aborted the install *after* every skill was placed and
  *before* the manifest was written, leaving an installed tree that the next `--check` called "never
  installed here". Such a file is now folded into the digest as the error it is — a real state of
  the tree, and one the check should notice. (B-002)


- Two `.sort()` calls in the coverage script now carry explicit comparators. One of them sorted an
  array of `[name, version]` pairs by the stringified pair rather than by name — correct today, and
  wrong the moment one package name is a prefix of another and their versions differ. Found by
  SonarQube on the release PR. (B-010)

## [0.6.0] - 2026-08-27

### Added

- The nightly drift job now **fails** when a package the skills teach was not installed at the
  version that run resolved from the registry. It names the package, both versions, and which of
  three things went wrong — the package is not in the install list (so whatever is on disk came from
  the lockfile), or it was resolved and never installed, or the lockfile shadowed the version that
  was resolved. Each has a different fix, so they are reported differently. The failure says
  `BOOKKEEPING MISMATCH — this is not API drift` in those words, and files no drift issue: someone
  forgetting to update a list and a package removing an export are answered differently and must not
  look alike. (B-010)


### Changed

- The two workflow steps that read the coverage now do genuinely different things. The reporting
  step lists what is installed and cannot fail; the assertion step prints its verdict and fails on a
  mismatch. Before this, one function did both and the reporting step — which is not given the
  resolved-version list — exited 1 on **every run**, printing a misleading mismatch that
  `continue-on-error` swallowed. A green job whose diagnostic step errored daily. (B-010)

- The assertion's verdict reaches the log. It was being discarded, so the only number a reader saw
  in a healthy run was the count of packages *present* — the measure this release replaced because
  it cannot tell a verified package from one the lockfile supplied. (B-010)

- The failure's closing advice is chosen by cause. It used to tell every failure to edit the install
  list, which is the wrong instruction for two of the four causes and, for an empty corpus, points at
  a file that cannot possibly help. (B-010)

- The coverage gate refuses two shapes of missing input instead of reporting them clean: an empty
  skills corpus (the extractor broke, or `skills/` moved) and a resolved-version list carrying a
  token with no version. The second mattered most: a truncated token used to be dropped silently, so
  the package it named was reported as "not in the install list" and the reader was told to add
  something that was already there. A confident wrong instruction costs more than a refusal. (B-010)

- **The job's `taught-surface-coverage: 7/7` was vacuous, and had been since it was written.**
  Measured on a dispatched run: with the install list shrunk to a single package it still reported
  7/7, because `npm install --no-save <pkg>` also installs `package.json`'s dependencies and all
  seven taught packages are devDependencies. Six arrived from the lockfile at versions that by
  construction cannot have moved — the exact gap the job exists to close, through a side door. One
  of them, `@theokit/sdk-tools`, was a published release behind while being counted as covered. The
  number now compares against what the run resolved, not against what happens to be on disk. (B-010)

- The comparison moved out of an inline `node -e` inside the workflow and into
  `scripts/taught-coverage.mjs`, with unit tests. A script embedded in YAML cannot be tested, and
  this one carried its own import extractor — the third in the repository after B-008 unified the
  two under `tests/`. Measured before the change: it agreed with the shared extractor today
  (29 specifiers either way), so the divergence was latent rather than active. (B-010)

## [0.5.0] - 2026-08-27

### Added

- Mutation testing, configured against the existing `node --test` suite. The first run measured
  **456 mutants and a score of 58.8%** (268 killed, 188 survived) over `lib/` and `bin/`. That is
  below the 60% floor, so the quality gate stays capped — by a measurement now, rather than by the
  absence of one. Three consecutive plans had dismissed that cap by ADR, which is how a gate becomes
  a ritual. Read the score with its shape: a third of the survivors are string literals in report
  output, which no test asserts on deliberately, so 58.8% under-reports the real protection.
  `lib/manifest.mjs` survives only 13% of its mutants; `bin/install.mjs` survives 48%. (B-007)

- The nightly drift job now installs **every** `@theokit` package the skills import at `@latest`,
  not only `@theokit/sdk`. Measured before the change: the skills teach **175 symbols across seven
  packages**, and the job reached 137 of them (78%) at a currently published version — the other 38
  arrived from the lockfile, at versions that by construction cannot have moved. A removed export
  in a gateway adapter or in `@theokit/di` produced no signal here. The job also prints its own
  coverage now (`taught-surface-coverage: 7/7`), so the same gap cannot return silently when a
  package is added to a skill and not to the install line. (B-004)

- The drift gate now resolves the five `@theokit` specifiers it used to report as
  `not checked (not installed here)`. `@theokit/di`, `@theokit/di-agent` and the Discord, Slack and
  Telegram gateway adapters are installed as devDependencies, so the 33 symbols four skills teach
  from them are compiled against the published declarations instead of being named as unverified.
  Measured: **68 imports resolved before, 103 after**. A new assertion turns the old stdout report
  into a gate that can fail — it carries the same anti-vacuity guard as its sibling, so a broken
  extractor goes red instead of green. `dependencies` stays empty; `npx @theokit/skills` is
  unaffected. (B-005)

- A resolution gate: every `import` in every skill is compiled against the installed `@theokit/sdk`, so a symbol that never existed — or one imported from a subpath that does not export it — fails CI. The sibling drift gate matches names it was told about; this one asks the compiler. Specifiers it cannot check (`@theokit/di`, `@theokit/di-agent`, the gateway packages, which are not installed here) are named on every run rather than silently skipped.


### Changed

- The code-quality allowlist carries one entry, sunset `2026-11-25`, downgrading the
  `mutation_unconfigured` soft cap by a single level. Required by
  `code-quality-golden-rule.md § 4`, and recorded because it is not a decision that mutation
  testing is unnecessary: without it, no plan in this repository could pass the `/implement` gate,
  including the plan that would configure the mutation runner. Owned by B-007; remove the entry
  when that lands.


### Fixed

- `qs` was pinned to a version carrying a moderate DoS advisory, reachable through two dev-only
  paths (the new mutation tooling, and the Slack gateway adapter added earlier today). An
  `overrides` entry moves it to a patched release: `npm audit` reports zero at every severity.
  Dev tree only — `dependencies` stays empty and nothing here reaches a consumer. (B-007)

- The test written to prevent the two gates diverging could not detect the divergence. It compared
  `specifiersIn` against `importsIn`, and the first is implemented by calling the second — a wrapper
  against its own delegate, agreeing by construction. Replaced by a structural guard that reads every
  test file and fails when one parses imports itself; demonstrated failing against the exact
  divergence it exists to catch. (B-008)

- The two drift gates disagreed about what counts as a taught import: `no-blind-specifier` carried
  a copy of `api-resolves`'s extractor without its deprecated-fence exclusion, so an import inside
  a `Before:` or `Don't:` block counted for one gate and not the other. Latent — no skill teaches
  by contrast with an uninstalled package today — and active the first time one does. There is now
  one extractor in `tests/_skills.mjs`, with the exclusion as the default rather than the option,
  and a structural guard that fails when any test file parses imports itself. (B-008)

- The deprecated-fence marker never matched `❌ Do not:`, despite listing `❌`. The pattern put the
  emoji inside a group followed by `\b`, and a word boundary after a non-word character does not
  match what follows — so an example marked with the emoji was treated as a real import by BOTH
  gates. Found by the new agreement test, not by a reader. (B-008)

- The manifest no longer claims this package is built with pnpm. `packageManager` named pnpm and
  `engines` required `pnpm >= 10.34.1`, while the repository ships a `package-lock.json`, has no
  pnpm lockfile, and installs with `npm` in every CI job — so a contributor who trusted the field
  and ran `pnpm install` got a working install and a **second lockfile**, after which the two
  disagreed about the tree and only one of them was under test.

  `engines.pnpm` is the half that would have reached consumers: it is published metadata, and pnpm
  validates it. A user running `pnpm dlx @theokit/skills` on pnpm 9 would have been told this CLI
  needs a package manager it does not use. It never shipped — 0.4.1 is the published version and
  carries no `engines` at all — so this corrects it before anyone could hit it.

  `engines.node` and `.nvmrc` stay. Pinning Node was the useful half of that change; pinning a
  package manager the repository does not use was not. (#5)

### Security

- The nightly drift job installs its seven packages with `--ignore-scripts`. It resolves them at
  `@latest` into a runner holding `issues: write`, so a lifecycle script in any of them — or in
  anything they pull — would have run with that token. Measured before the change: zero packages in
  the resolved tree declare `preinstall`/`install`/`postinstall`, so the flag closes the path
  without costing anything. Found by SonarQube (`githubactions:S6505`) on the release PR, in the
  install line this release had just widened from one package to seven. The companion finding
  (`S8543`, unlocked versions) turned out to have a real remedy after all: the job now resolves each
  taught package to a concrete version against the live registry and installs *that*, instead of
  installing a mutable `@latest` tag. Resolution stays live — the job still asks what is published
  today — while the install becomes reproducible, and the drift issue now names the exact versions
  a failure was seen against instead of saying only that the SDK moved.


## [0.4.2] - 2026-08-20

### Fixed

- `theokit-workflows` taught `import { Workflow, fn, agentStep } from "@theokit/sdk"`. The published SDK exports those from `@theokit/sdk/workflow`, not the root, so an agent following the skill wrote an import that does not compile. Found by the new resolution gate on its first run, which is the argument for the gate.

### Added

- A gate that RESOLVES every `@theokit` symbol the skills teach against the installed SDK, rather than matching known-bad names. The sibling pattern gate knows the twelve factories removed at v3.0 and cannot know the thirteenth; this one asks the compiler the same question a reader's editor asks. `typescript` and `@theokit/sdk` are devDependencies, which never reach a consumer, so `npx @theokit/skills` is unaffected.
- A scheduled workflow that runs that gate against whatever `@theokit/sdk` is CURRENTLY published and opens one issue when it fails. These skills used to live inside the SDK, so a pull request removing an export touched them in the same diff; that coupling is gone, and this is what replaces it. Measured at the move: the SDK's own drift gate went from 112 verified imports to 43, and the 69 that left were these.

### Added

- `Workflow Lint`, a CI gate running actionlint and zizmor over `.github/workflows/` (#4)
- `engines`, `packageManager` and `.nvmrc`, so CI and a contributor resolve the same Node and
  pnpm instead of each taking whatever they find (#4)

### Security

- The publish step no longer sets `NODE_AUTH_TOKEN`. It was a bootstrap crutch kept after the
  bootstrap, and the npm CLI prefers token auth over OIDC — so re-adding the secret for any reason
  would have silently dropped the trusted-publisher binding and the provenance attestation with
  it, with no error (#4)
- Every GitHub Action is pinned to a commit SHA rather than a movable tag, and the npm that
  performs the publish is pinned to an exact version rather than `@latest` (#4)
- Checkouts no longer leave the job token in `.git/config`; nothing here pushes with git (#4)

## [0.4.1] - 2026-08-20

### Changed

- `RELEASING.md` described a setup that has since been done. It told the reader to create an npm token and wire it as a secret; publishing now authenticates over OIDC trusted publishing, so there is no token, no secret, and nothing to rotate. A runbook whose first instruction is a step you must NOT take is worse than no runbook. The bootstrap history is kept, collapsed, with why that path is closed.

## [0.4.0] - 2026-08-20

### Changed

- BREAKING: the package is now `@theokit/skills` and its command is `npx @theokit/skills`. It holds every skill in the TheoKit ecosystem rather than one, and installs into every AI coding tool rather than Claude Code alone. The previous name published four versions and nineteen weekly downloads; no migration path is provided because there is effectively nothing to migrate.

### Added

- Installs to write LOCATIONS instead of per-tool adapters. `.agents/skills/` is read by OpenAI Codex, Gemini CLI, GitHub Copilot, Zed and Devin Desktop; `.claude/skills/` by Claude Code and Copilot in VS Code; `.github/skills/` by the github.com Copilot surfaces. Two directories serve six tools, so a per-tool list would write the same bytes five times and then have to keep five copies in step.
- Links the installed skill to the package when that is valid, so it follows your lockfile instead of freezing at install time. On Windows the link is a junction, which needs no Administrator rights or Developer Mode; elsewhere it is a relative symlink. Falls back to copying whenever a link would dangle — notably under `npx`, where this package lives in a cache that gets pruned — and always reports which mode it produced.
- `--check`, a CI gate that fails when the installed skills drift from the package: never installed, installed from another version, or installed and since deleted. An instruction file that has gone stale is followed as diligently as a current one, and nothing else surfaces that.
- `--target`, `--skill`, `--dry-run`, `--copy` and `--global`, plus a `.theokit-skills.json` manifest that makes re-running a no-op and is meant to be committed.
- CI now runs the suite and an end-to-end install on `ubuntu-latest`, `macos-latest` and `windows-latest`. Linking is the one behaviour that genuinely differs per platform, and a fallback nobody exercises is a fallback nobody has seen work.

### Fixed

- The test suite could never run. `tests/lint/no-ptbr.test.ts` imported `vitest`, which this zero-dependency package does not have, and used `__dirname`, which does not exist in ESM; the CI step that would have surfaced it (`node --test tests/`) fails on Node 22 before reaching any test — two breakages hiding each other. The lint is ported to `node:test` with its logic unchanged, and CI now runs `npm test`.


- Secret scanning, in two layers: a `pre-commit` hook that scans the staged content with TruffleHog and refuses the commit, and `.github/workflows/secret-scan.yml`, which re-scans the pushed range in CI. The hook is what keeps a credential out of the history at all; the workflow is what `git commit --no-verify` cannot skip. Confirmed fixtures are silenced one line at a time with a `trufflehog:ignore` comment, never by excluding a path — an excluded path would also hide a real secret added to that same fixture later. (secret-scanning-2026-08)

### Changed

- **The repository moved to the official `usetheokit` organization.** Existing clones keep working: GitHub redirects the old `usetheodev/theokit-skill` remote permanently. The `repository` field, the plugin manifest, and the README now point at `usetheokit`. (usetheokit/theokit#316)

- **The Apache-2.0 license text was replaced with the official one.** The text shipped until now had paragraph 4(d) truncated, dropping "reasonable and customary use" from the NOTICE clause. A modified body under the `Apache-2.0` SPDX identifier is effectively a custom license, and every consumer had to reason about the difference. (usetheokit/theokit#316)

## [0.3.0]

### Added
- Full public-surface coverage: references/ expanded from 14 to **30 modules** — every @theokit/sdk subpath now has a per-module snippet (models, subagents/a2a, retry, task-store, sandbox, compaction, messages, auth, sanitize, skills, path-safety, concurrency, persistence, client, filesystem, project added). Authored against the shipped .d.ts and synced from the SDK scaffold (drift-gated on both sides).

## [0.2.0]

### Added
- Per-module reference snippets under `skills/theokit-sdk/references/` (agent-core, tools, streaming, memory, cron, errors, workflows, eval, subscriptions, budget, config, plus optional di / di-agent / gateways). SKILL.md stays a concise overview and links each reference so it loads on demand. Generated from the `@theokit/sdk` scaffold via `node scripts/sync-references.mjs` — one source of truth, drift-gated by the SDK's CI (not a second hand-maintained copy).

### Fixed (0.1.1)
- Tool example used the wrong spec field `execute` — the canonical `Tool.create` field is `handler` (returns a string, or a typed value with `outputSchema`).

## [0.1.0]

### Added
- Initial release. The `theokit-sdk` authoring skill for `@theokit/sdk`, authored against the shipped type declarations (Agent.create/prompt, Tool.create with Zod, streaming SDKMessage events, run.wait/cancel, MCP servers, subagents, cron, memory/context/skills, resource disposal, TheokitAgentError hierarchy, and anti-patterns).
- npx installer (`@theokit/skill`): `npx @theokit/skill` copies the skill into `~/.claude/skills` (personal, all projects); `--project` targets `./.claude/skills`; `--force` overwrites.
- Also distributable as a native Claude Code plugin via the `theokit` marketplace (`/plugin marketplace add usetheodev/theokit-skill` + `/plugin install theokit-sdk@theokit`).
