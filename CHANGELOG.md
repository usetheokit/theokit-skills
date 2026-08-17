# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Secret scanning, in two layers: a `pre-commit` hook that scans the staged content with TruffleHog and refuses the commit, and `.github/workflows/secret-scan.yml`, which re-scans the pushed range in CI. The hook is what keeps a credential out of the history at all; the workflow is what `git commit --no-verify` cannot skip. Confirmed fixtures are silenced one line at a time with a `trufflehog:ignore` comment, never by excluding a path — an excluded path would also hide a real secret added to that same fixture later. (secret-scanning-2026-08)

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
