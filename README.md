# @theokit/skills

Agent skills for the TheoKit ecosystem, and the machinery that puts them where your AI coding tool
will read them — Claude Code, OpenAI Codex, Gemini CLI, GitHub Copilot, Zed, Devin Desktop, on
Windows, macOS and Linux.

## Read this first: the corpus is empty

`skills/` contains nothing. Commit `9c2e340` deleted all 32 hand-written skills, and the replacement
is being built. **Running `npx @theokit/skills` today installs zero skills.** The installer works; it
has nothing to install.

`@theokit/skills@0.9.2` is on npm and still carries the old corpus. Nothing here has been published
since, and nothing should be until the corpus returns — a release from this tree would ship an
installer with an empty payload.

## Why the corpus was deleted rather than fixed

The skills were written by hand, and nothing in the process could tell correct code from plausible
code. Two cases are on record in `CHANGELOG.md`: one skill taught `await using`, which needs Node 24,
in a package declaring `>=22.12.0`; another imported `zod` without naming the major, in a package
depending on `zod@^4`. Both examples read well. Neither worked.

The replacement generates skills instead of writing them, and splits the work by what each part can
actually prove:

| Part | Produces | Why that part |
| --- | --- | --- |
| [`theokit-examples`](https://github.com/usetheokit/theokit-examples) and its CI | the example code, verbatim | it is the only thing that executes it |
| the `.d.ts` of the pinned package version | the public API surface | it is what you publish |
| an LLM | the prose: what, when, why, pitfalls | it is where types and tests are silent |

No line of code and no API signature in a generated skill is written by a model. Code is copied
byte-for-byte out of an example that CI ran, comments included — an example's doc comments record
what a signature cannot, and paraphrasing them would lose the only content no model could reproduce.

The full design is in
[`docs/superpowers/specs/2026-08-28-theokit-skills-redesign-design.md`](docs/superpowers/specs/2026-08-28-theokit-skills-redesign-design.md).
It lands in three plans: the example contract (done), the generator, then distribution and release.

## What works today: the example contract

An example can only be a skill source if it has a predictable shape. Fifty examples in fifty shapes
would turn extraction into a pile of special cases, and every special case is a chance to extract the
wrong thing quietly.

```bash
npx theokit-check-example ../theokit-examples
```

It treats any directory holding a `skill.json` as an example and reports every way that example
departs from the contract — 15 named rules covering required files, exact dependency pins, strict
TypeScript, the manifest schema, and both directions of the lesson cross-check. It reports all of
them in one run rather than stopping at the first, and it exits non-zero when a tree contains no
example at all, because silence over an empty set is the worst output a checker can give.

The rules are documented, each under the name the failure message prints, in
[`theokit-examples/EXAMPLE-CONTRACT.md`](https://github.com/usetheokit/theokit-examples/blob/workspace/EXAMPLE-CONTRACT.md).

| Module | Responsibility |
| --- | --- |
| `lib/lessons.mjs` | parse `#region skill:<id>` markers out of one source file |
| `lib/skill-manifest.mjs` | validate one `skill.json`; knows the schema, not the filesystem |
| `lib/example-contract.mjs` | compose those with filesystem facts into a list of violations |
| `bin/check-example.mjs` | walk a tree, report per example, exit non-zero on any violation |

`npm test` runs 44 tests over those four files with `node --test` and no test framework. The suite
runs on `ubuntu-latest`, `macos-latest` and `windows-latest`.

## The installer

Unchanged, and accurate as described — it is the payload that is missing, not the mechanism.

```bash
npx @theokit/skills
```

Surveying the vendor documentation on 2026-08-20 produced one finding that shrinks the problem:
`.agents/skills/` is read by OpenAI Codex, Gemini CLI, GitHub Copilot, Zed and Devin Desktop. Claude
Code is the holdout — its documentation says plainly that it reads `.claude/`. So two directories
serve six tools, and a third, `.github/skills/`, is the only path the github.com-side Copilot
surfaces read.

| Target | Directory | Serves |
| --- | --- | --- |
| `agents` | `.agents/skills/` | OpenAI Codex, Gemini CLI, GitHub Copilot, Zed, Devin Desktop |
| `claude` | `.claude/skills/` | Claude Code, GitHub Copilot in VS Code |
| `github` | `.github/skills/` | GitHub Copilot on github.com (Chat, code review) |

The unit is the **location**, not the tool: a per-tool adapter list would write the same bytes five
times and then need five copies kept in step.

A skill is **linked** when this package is a dependency of your project and you install in project
scope, and **copied** otherwise. A link makes the installed skill follow your lockfile; but run
through `npx` this package lives in a prunable cache, and a link into it is a link into nothing —
silently, since the agent simply finds no skill. On Windows the link is a junction, which needs
neither Administrator rights nor Developer Mode. Every failure falls back to copying, and the output
says which mode you got.

```
--global            install for your user instead of this project
--force             replace what is already there
--copy              copy even where linking would work
--dry-run           print the plan, write nothing
--check             exit non-zero when what is installed no longer matches this package
--target=<id>       agents | claude | github   (repeatable; default: detected)
--skill=<name>      install one skill (repeatable; default: all)
```

Re-running is a no-op. `.theokit-skills.json` records what landed, from which version, in which mode.
`CLAUDE_CONFIG_DIR` is honoured, because Claude Code honours it.

**All of this is slated for removal.** The redesign derives what to install from your lockfile and
always copies, which deletes the link/copy decision, the manifest and `--check` together: divergence
stops being policed because it stops being possible. That is the third plan; until it lands, the
mechanism above is what the published package does.

## What the suite does not cover

`bin/install.mjs` has no unit tests — they went with the corpus in `9c2e340`. What remains is the
CI smoke job, which on all three platforms asserts the one property that is checkable today: the
installer refuses an empty corpus rather than reporting success over nothing. Coverage of a real
install returns with the corpus.

## License

Apache-2.0.
