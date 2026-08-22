# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
