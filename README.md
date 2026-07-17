<p align="center">
  <a href="https://usetheo.dev">
    <img src="https://usetheo.dev/logo-128.png" alt="Theo" height="80" />
  </a>
</p>

<h1 align="center">theokit-sdk skill for Claude Code</h1>

<p align="center">
  <strong>Install once, and Claude Code writes correct <code>@theokit/sdk</code> code.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square"></a>
  <img alt="Claude Code" src="https://img.shields.io/badge/Claude%20Code-plugin-6B48FF?style=flat-square">
</p>

---

A [Claude Code](https://code.claude.com) plugin that teaches your assistant the [`@theokit/sdk`](https://www.npmjs.com/package/@theokit/sdk) surface — the TypeScript SDK for the Theo agent harness. It loads accurate, up-to-date knowledge (verified against the shipped type declarations) so Claude writes correct SDK code without you scaffolding a `.claude/` directory into every project.

## What it knows

`Agent.create` / `Agent.prompt` · `Tool.create` with Zod schemas · streaming `SDKMessage` events (`system` / `user` / `assistant` / `thinking` / `tool_call` / `status` / `task` / `request`) · `run.wait` / `run.cancel` · MCP servers · subagents · cron jobs · memory / context / skills · resource disposal (`await using`) · the `TheokitAgentError` hierarchy · and the anti-patterns to avoid (no `new Agent()`, no removed `define*` factories, no `@theokit/sdk/internal/*` imports).

## Install

```text
/plugin marketplace add usetheodev/theokit-skill
/plugin install theokit-sdk@theokit
```

Then start writing SDK code — the skill loads automatically when you work with `@theokit/sdk`, or invoke it directly with `/theokit-sdk`. Run `/reload-plugins` if you installed it mid-session.

## Why a plugin (vs `npx theokit-init-claude`)

`theokit-init-claude` scaffolds SDK knowledge **into each project's** `.claude/`. This plugin installs the same expertise **once, globally**, so every project's Claude Code has it — nothing committed to your repo, one place to update.

## Staying accurate

The skill is authored against the exported types of `@theokit/sdk`, which are the canonical contract. When the SDK ships a breaking surface change (a new major), regenerate the skill from the current type declarations and cut a new plugin version. The skill deliberately covers only verified-real exports — it will not teach a subpath or factory that isn't in the shipped `.d.ts`.

## License

Apache-2.0 — see [LICENSE](LICENSE).

## Links

- SDK: [`@theokit/sdk`](https://www.npmjs.com/package/@theokit/sdk) · [source](https://github.com/usetheodev/theokit-sdk)
- Theo: [usetheo.dev](https://usetheo.dev) · [Discord](https://discord.usetheo.dev/)
