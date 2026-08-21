---
name: theokit-sdk
description: Author agents with @theokit/sdk (TypeScript). Covers Agent.create / Agent.prompt, Tool.create with Zod, streaming SDKMessage events, run.wait/cancel, MCP servers, subagents, cron jobs, memory/context/skills, resource disposal, and the TheokitAgentError hierarchy. Use when writing or reviewing TypeScript that imports @theokit/sdk, builds or resumes an agent, defines a tool, streams a run, schedules a cron job, or handles a Theokit error.
---

# @theokit/sdk authoring

The TypeScript SDK for the Theo agent harness. One API, two runtimes (local / cloud), picked by the key you pass to `Agent.create()`. The exported types are the canonical contract.

Requires Node 22.12+. `npm install @theokit/sdk`. Auth via `THEOKIT_API_KEY` (or an explicit `apiKey` option).

## Per-module skills

Thirty sibling skills cover the rest of the surface, one per module. Each carries a `paths:` glob, so
the one matching what you are editing loads on its own and the others cost nothing — the whole reason
they are separate skills rather than one long document.

**Core** — `theokit-agent-core` (create/prompt/send/resume, factory) · `theokit-tools` (Tool.create,
`@theokit/sdk-tools`, hooks) · `theokit-streaming` (SDKMessage, deltas) · `theokit-memory` ·
`theokit-cron` · `theokit-errors` · `theokit-workflows` · `theokit-eval` · `theokit-subscriptions` ·
`theokit-budget` · `theokit-config`.

**Models, runtime & delegation** — `theokit-models` · `theokit-subagents` (`/a2a` + tool-scope) ·
`theokit-retry` · `theokit-task-store` · `theokit-sandbox` · `theokit-compaction` ·
`theokit-messages` (readers) · `theokit-sanitize` · `theokit-skills` · `theokit-auth`
(`/server/auth` + errors-envelope).

**Utilities** — `theokit-path-safety` · `theokit-concurrency` · `theokit-persistence` ·
`theokit-client` · `theokit-filesystem` · `theokit-project`.

**Optional ecosystem packages** (separate installs) — `theokit-di` (`@theokit/di`) ·
`theokit-di-agent` (decorators) · `theokit-gateways` (`@theokit/gateway-*`).

They are authored here and gated against the installed `@theokit/sdk` type declarations, so a skill
cannot teach an API the package does not have.

## Import map (verified subpaths)

```typescript
import { Agent, Cron, Tool } from "@theokit/sdk";              // core surface
import { TheokitAgentError } from "@theokit/sdk/errors";       // error hierarchy
import { Workflow } from "@theokit/sdk/workflow";              // multi-step workflows
import { Eval } from "@theokit/sdk/eval";                      // evaluation suite
import { Subscription } from "@theokit/sdk/subscription";      // SSE / WebSocket subscriptions
```

Other public subpaths: `/messages`, `/models`, `/skills`, `/project`, `/subagents`, `/a2a`, `/sandbox`, `/task-store`, `/client`, `/persistence`, `/retry`, `/concurrency`, `/sanitize`, `/server/auth`. There is **no** `@theokit/sdk/rag` subpath. Never import from `@theokit/sdk/internal/*` or `@theokit/sdk/dist/*`.

## Agent lifecycle

`Agent.create()` validates options and returns a handle immediately; `agent.agentId` is `agent-<uuid>` (local) or `bc-<uuid>` (cloud).

```typescript
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
});

const run = await agent.send("Summarize what this repository does");
for await (const event of run.stream()) {
  if (event.type === "assistant") {
    for (const block of event.message.content) {
      if (block.type === "text") process.stdout.write(block.text);
    }
  }
}
```

- `agent.send(prompt)` → `Run` (the agent retains conversation context across sends).
- `agent.send({ text, images: [{ data: base64, mimeType }] })` → multimodal send.
- `Agent.prompt(prompt, options)` → one-shot (create + send + dispose). **Prompt is the first argument.**
- `Agent.resume(agentId, { apiKey })` → reattach; runtime auto-detected from the ID prefix.
- `Agent.list`, `Agent.get`, `Agent.getRun`, `Agent.listRuns` → inspection; list results paginate via `nextCursor`.

Per-send options include `model` (sticky override), `mcpServers` (replaces creation-time servers for that run), `onStep`, `onDelta`, and `local.force`.

## Tools — `Tool.create` with a Zod schema

The canonical factory is `Tool.create` (the uniform `X.create()` API since v3.0). There is **no** `defineTool` export.

```typescript
import { z } from "zod";
import { Tool } from "@theokit/sdk";

const roll = Tool.create({
  name: "roll",
  description: "Roll N dice with S sides each.",
  inputSchema: z.object({
    count: z.number().int().min(1).max(100),
    sides: z.number().int().min(2).max(1000),
  }),
  handler: async ({ count, sides }) => JSON.stringify({ total: rollDice(count, sides) }),
});
```

Every public factory follows the same shape: `Provider.create`, `Plugin.create`, `Subscription.create`, `Auth.create`, `SubAgent.create`, `Squad.create`, `Retry.create`, … Never author `define*` / `create*` free functions — those were removed at v3.0.

## Streaming — `SDKMessage` events

`run.stream()` is an `AsyncGenerator` of discriminated `SDKMessage`. Switch on `type`. All events carry `agent_id` and `run_id`.

| `type` | Meaning | Key fields |
| --- | --- | --- |
| `system` | Init metadata, once at start | `subtype?`, `model?`, `tools?` |
| `user` | Echo of the prompt | `message.content: TextBlock[]` |
| `assistant` | Model text output | `message.content: (TextBlock \| ToolUseBlock)[]` |
| `thinking` | Reasoning content | `text`, `thinking_duration_ms?` |
| `tool_call` | Tool lifecycle (start with `args`, again on completion with `result`) | `call_id`, `name`, `status`, `args?`, `result?` |
| `status` | Cloud run lifecycle | `status`, `message?` |
| `task` | Task milestones | `status?`, `text?` |
| `request` | Awaiting input/approval | `request_id` |

The event names are exactly these — there is no `tool_use` / `tool_result` / `usage` / `error` event. Treat `tool_call` `args`/`result` as `unknown` and parse defensively; the envelope (`type`, `call_id`, `name`, `status`) is stable, the payloads are not.

Result data lives on the `Run` after the stream ends:

```typescript
const result = await run.wait();
result.status;      // "finished" | "error" | "cancelled"
result.result;      // final assistant text, if any
result.model;       // resolved ModelSelection
result.durationMs;
await run.cancel();  // aborts the live stream + in-flight tool calls; no-op if finished
```

For lower-level updates, pass `onDelta` (per-token `InteractionUpdate`) and `onStep` to `agent.send()`; both are awaited so you can apply backpressure.

## Errors

All SDK errors extend `TheokitAgentError`. Drive retries with `isRetryable`.

```typescript
import { TheokitAgentError } from "@theokit/sdk/errors";

try {
  await agent.send("...");
} catch (e) {
  if (e instanceof TheokitAgentError) console.error(e.code, e.isRetryable, e.message);
}
```

Subclasses: `AuthenticationError`, `RateLimitError`, `ConfigurationError`, `IntegrationNotConnectedError`, `NetworkError`, `UnknownAgentError`, `UnsupportedRunOperationError` (check `run.supports(op)` first).

## MCP, subagents, cron, memory

**MCP servers** — inline on create or send (first-match-wins over file sources):

```typescript
const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
  mcpServers: {
    docs: { type: "http", url: "https://example.com/mcp", auth: { CLIENT_ID: "id", scopes: ["read"] } },
    fs: { type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", process.cwd()] },
  },
});
```

File sources (`.theokit/mcp.json`, `~/.theokit/mcp.json`, plugins) load only when `local.settingSources` includes `"project"` / `"user"` / `"plugins"`.

**Subagents** — `agents: { "code-reviewer": { description, prompt, model: "inherit" } }`; committed `.theokit/agents/*.md` are also picked up.

**Cron** — `import { Cron } from "@theokit/sdk"`:

```typescript
const job = await Cron.create({
  cron: "0 9 * * *",
  timezone: "America/Sao_Paulo",
  message: "Summarize yesterday's commits",
  agent: { apiKey: process.env.THEOKIT_API_KEY!, model: { id: "google/gemini-2.0-flash-001" }, local: { cwd: process.cwd() } },
});
await Cron.start(); // required for LOCAL jobs to fire; cloud jobs fire server-side
```

Bind a job with `agent` (ephemeral per fire) OR `agentId` (bound), never both. 5-field POSIX cron plus `@hourly`/`@daily`/`@weekly`/`@monthly`/`@yearly`.

**Memory / context / skills** — options on `Agent.create`: `memory: { enabled, namespace, userId, scope }` (never store credentials), `context: { manager: "file", maxTokens }`, `skills: { enabled: [...] }` (packs at `.theokit/skills/<name>/SKILL.md`).

## Resource disposal

Always dispose. Cleanest is `await using`:

```typescript
await using agent = await Agent.create({ /* ... */ });
// disposed when the block exits
```

Explicit: `await agent[Symbol.asyncDispose]()`. `agent.close()` starts disposal fire-and-forget. `agent.reload()` re-reads file-based config (hooks, project MCP, subagents) without disposing.

## Anti-patterns

- Never `new Agent()` — always `await Agent.create()`.
- Never author `defineTool` / `defineSubscription` / `defineAuth` / `defineSubAgent` — use `Tool.create` / `Subscription.create` / `Auth.create` / `SubAgent.create`.
- Never switch on `tool_use` / `tool_result` / `usage` / `error` stream events — they don't exist; use `tool_call` / `assistant` / `thinking` / `status`.
- Never read assistant text as `event.content` — it's `event.message.content` (a block array).
- Never import from `@theokit/sdk/internal/*` or `@theokit/sdk/dist/*`, and never from `@theokit/sdk/rag` (no such subpath).
- Never forget disposal — it leaks the runtime.
- Never type tool inputs as `any` — use a Zod schema.
- Cloud runtime depends on Theo PaaS (pre-release); the local runtime is the tested path.
