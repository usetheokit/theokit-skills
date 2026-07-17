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

```bash
npx @theokit/skill            # installs into ~/.claude/skills (all your projects)
npx @theokit/skill --project  # installs into ./.claude/skills (committable, this repo only)
npx @theokit/skill --force    # overwrite an existing copy
```

Then start writing SDK code — the skill loads automatically when you work with `@theokit/sdk`, or invoke it directly with `/theokit-sdk`.

<details>
<summary>Prefer the native Claude Code plugin flow?</summary>

```text
/plugin marketplace add usetheodev/theokit-skill
/plugin install theokit-sdk@theokit
```

Run `/reload-plugins` if you installed it mid-session. Same skill, distributed as a plugin instead of copied via npx.

</details>

## `@theokit/skill` vs `theokit-init-claude`

Both install via `npx`, but differ in scope:

| | `npx @theokit/skill` | `npx theokit-init-claude` |
| --- | --- | --- |
| Installs | just the `theokit-sdk` authoring skill | a full project scaffold (`AGENTS.md`, `CLAUDE.md`, skills, settings) |
| Default target | `~/.claude/skills` (personal, all projects) | `./.claude` (this project, committable) |
| Use when | you want SDK expertise everywhere, nothing in your repo | you want a per-project, committed setup |

## Per-module references

`SKILL.md` is a concise overview; deeper per-module snippets live in `skills/theokit-sdk/references/*.md` (agent-core, tools, streaming, memory, cron, errors, workflows, eval, subscriptions, budget, config, plus optional di / di-agent / gateways). They load on demand when Claude works on that surface.

The references are **generated from the `@theokit/sdk` scaffold**, not hand-maintained here — one source of truth, protected by the SDK's own drift-gate CI. Regenerate after bumping the SDK:

```bash
npm i @theokit/sdk@latest && npm run sync-references
```

## Staying accurate

The skill is authored against the exported types of `@theokit/sdk`, which are the canonical contract. It deliberately covers only verified-real exports — it will not teach a subpath or factory that isn't in the shipped `.d.ts`.

## License

Apache-2.0 — see [LICENSE](LICENSE).

## Links

- SDK: [`@theokit/sdk`](https://www.npmjs.com/package/@theokit/sdk) · [source](https://github.com/usetheodev/theokit-sdk)
- Theo: [usetheo.dev](https://usetheo.dev) · [Discord](https://discord.usetheo.dev/)
