# @theokit/skills

Installs the TheoKit ecosystem's agent skills into whichever AI coding tools you actually use, on
Windows, macOS and Linux.

```bash
npx @theokit/skills
```

That is the whole thing. It detects the tools configured in your project, writes the skills where
each one reads them, and tells you what it did.

## Why this is not one adapter per tool

Surveying the vendor documentation on 2026-08-20 produced one finding that shrinks the problem:

**`.agents/skills/` is read by OpenAI Codex, Gemini CLI, GitHub Copilot, Zed and Devin Desktop.**
Claude Code is the holdout — its documentation says plainly that it reads `.claude/`, and the
request for `.agents/` support is unanswered.

So two directories serve six tools. A third, `.github/skills/`, is the only path the github.com-side
Copilot surfaces (Chat, code review) read; they ignore `.agents/`.

| Target | Directory | Serves |
| --- | --- | --- |
| `agents` | `.agents/skills/` | OpenAI Codex, Gemini CLI, GitHub Copilot, Zed, Devin Desktop |
| `claude` | `.claude/skills/` | Claude Code, GitHub Copilot in VS Code |
| `github` | `.github/skills/` | GitHub Copilot on github.com (Chat, code review) |

Modelling this as a per-tool adapter list would write the same bytes five times and then require
five copies to be kept in step. The unit here is the **location**, not the tool.

## Linked, or copied — and why you are told which

A link is the better artifact: it makes the installed skill follow your lockfile, so
`npm update @theokit/skills` updates the instructions instead of leaving last year's copy that your
agent obeys with the same diligence as a current one.

A link is only valid where the source outlives the process. Run through `npx`, this package lives in
a temporary npm cache that gets pruned, and a link into it is a link into nothing — silently, since
the agent simply finds no skill. So:

- **Linked** when this package is a dependency of your project (`npm i -D @theokit/skills`) and you
  install in project scope.
- **Copied** otherwise, and whenever the filesystem refuses a link.

On Windows the link is a **junction**, which needs no Administrator rights and no Developer Mode —
unlike a symlink, which needs one of them. Elsewhere it is a relative symlink, so moving the tree
does not break it. Every failure falls back to copying, and the output says which mode you got: a
silent downgrade would make "installed" mean two different things with no way to tell them apart.

This is verified rather than asserted — the suite runs on `ubuntu-latest`, `macos-latest` and
`windows-latest`, and the end-to-end test spawns the real installer in a real temporary project on
each.

## Keeping it honest: `--check`

```bash
npx @theokit/skills --check
```

Exits non-zero when what is installed no longer matches this package: never installed, installed
from a different version, or installed and since deleted. Three states rather than a boolean,
because the fixes differ.

Put it in CI. An instruction file that has gone stale is followed exactly as diligently as a current
one, and nothing else surfaces the divergence — which is the most-cited criticism of shipping
instruction files at all, and the reason this command exists.

## Options

```
--global            install for your user instead of this project
--force             replace what is already there
--copy              copy even where linking would work
--dry-run           print the plan, write nothing
--target=<id>       agents | claude | github   (repeatable; default: detected)
--skill=<name>      install one skill (repeatable; default: all)
```

Re-running is a no-op. `.theokit-skills.json` records what landed, from which version, in which
mode; it is small, sorted and meant to be committed.

`CLAUDE_CONFIG_DIR` is honoured, because Claude Code honours it — installing into `~/.claude` when
you have relocated your config writes a directory the tool never reads.

## What ships

Every skill in the TheoKit ecosystem lives under `skills/` — 31 of them, covering the SDK core
(`Agent.create` / `Agent.prompt`, `Tool.create` with Zod, streaming `SDKMessage` events,
`run.wait` / `cancel`, the `TheokitAgentError` hierarchy), the subsystems that ship beside it
(persistence, compaction, filesystem, sandbox, cron, memory, workflows, evaluation, budget), the
dependency-injection packages, and the gateway adapters for Discord, Slack and Telegram.

The content is generated from each package's own per-module sources and gated against drift, so a
bad sync cannot publish a skill teaching a removed API or a subpath that does not exist.

### A skill is curated, not a dump of the API

Measured 2026-08-27: the skills teach **176 distinct symbols across 29 subpaths**, while **545
exported symbols are taught by no skill at all** — `@theokit/sdk`'s root alone exports 387 and the
skills import 16 of them.

That gap is deliberate, and it is worth saying so plainly because the ratio looks alarming until you
know what a `SKILL.md` is for. It is **always-loaded context**: every symbol written into it costs
tokens in every conversation that loads the skill, whether or not that conversation needs it. An
agent given the whole surface is not better informed — it is more expensive and less directed.

So the gate runs in the other direction, and only in that direction: **nothing a skill teaches may
be missing from the package.** Measured across the 23 sampled subpaths, that count is **0**.

What this does *not* claim is that the curated 176 are the right 176. Nobody has measured which
exports matter, and nothing currently proposes a newly published export for inclusion — the drift
job watches for symbols that disappear, not for ones that appear. That is a known limit, not an
oversight.

## License

Apache-2.0.
