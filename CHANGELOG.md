# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Initial release. A Claude Code plugin shipping the `theokit-sdk` authoring skill for `@theokit/sdk`, authored against the shipped type declarations (Agent.create/prompt, Tool.create with Zod, streaming SDKMessage events, run.wait/cancel, MCP servers, subagents, cron, memory/context/skills, resource disposal, TheokitAgentError hierarchy, and anti-patterns). Installable via `/plugin marketplace add usetheodev/theokit-skill` + `/plugin install theokit-sdk@theokit`.
