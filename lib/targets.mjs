// Where an agent skill has to land on disk, and which tools each location serves.
//
// THE UNIT IS A DIRECTORY, NOT A TOOL. Researched 2026-08-20 against vendor documentation:
// `.agents/skills/` is read by OpenAI Codex, Gemini CLI, GitHub Copilot, Zed and Devin Desktop.
// Claude Code is the one holdout — its docs say plainly that it reads `.claude/`, and the
// long-standing request for `.agents/` support is unanswered. So two directories cover six tools,
// and modelling this as "one adapter per tool" would write the same bytes five times and then have
// to keep five copies in step.
//
// `.github/skills/` is a third, narrower target: it is the only path the github.com-side Copilot
// surfaces (Chat, code review) read, and those ignore `.agents/`.
//
// Sources, all vendor docs read on 2026-08-20:
//   Codex        https://learn.chatgpt.com/docs/build-skills          (.agents/skills, repo → user)
//   Gemini CLI   https://geminicli.com/docs/cli/skills/               (.agents/ wins over .gemini/)
//   Copilot      https://docs.github.com/en/copilot/concepts/agents/about-agent-skills
//   Zed          https://zed.dev/docs/ai/skills                       (.agents/skills)
//   Claude Code  https://code.claude.com/docs/en/skills               (.claude/skills only)

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Personal config root for Claude Code.
 *
 * `CLAUDE_CONFIG_DIR` is honoured because Claude Code honours it; installing into `~/.claude` when
 * the user has relocated their config writes a directory the tool will never read.
 */
function claudeHome() {
  const override = process.env.CLAUDE_CONFIG_DIR?.trim();
  return override && override.length > 0 ? override : join(homedir(), ".claude");
}

/**
 * The write targets, widest coverage first.
 *
 * `detect` answers "is this tool set up here?" by the presence of its config directory — the same
 * signal the ecosystem's installers use. It is a heuristic and it is allowed to be: a false
 * negative costs an extra `--target` flag, and a false positive costs an unread directory.
 */
export const TARGETS = [
  {
    id: "agents",
    label: ".agents/skills",
    serves: ["OpenAI Codex", "Gemini CLI", "GitHub Copilot", "Zed", "Devin Desktop"],
    projectDir: (cwd) => join(cwd, ".agents", "skills"),
    globalDir: () => join(homedir(), ".agents", "skills"),
    detect: (cwd) =>
      existsSync(join(cwd, ".agents")) ||
      existsSync(join(homedir(), ".agents")) ||
      existsSync(join(homedir(), ".codex")) ||
      existsSync(join(homedir(), ".gemini")),
  },
  {
    id: "claude",
    label: ".claude/skills",
    serves: ["Claude Code", "GitHub Copilot in VS Code"],
    projectDir: (cwd) => join(cwd, ".claude", "skills"),
    globalDir: () => join(claudeHome(), "skills"),
    detect: (cwd) => existsSync(join(cwd, ".claude")) || existsSync(claudeHome()),
  },
  {
    id: "github",
    label: ".github/skills",
    serves: ["GitHub Copilot on github.com (Chat, code review)"],
    projectDir: (cwd) => join(cwd, ".github", "skills"),
    // No personal scope: the github.com surfaces read from the repository, never from a home dir.
    globalDir: () => undefined,
    detect: (cwd) => existsSync(join(cwd, ".github")),
  },
];

/** Look up a target by its id, or `undefined`. */
export function targetById(id) {
  return TARGETS.find((target) => target.id === id);
}

/**
 * Targets that look set up in `cwd`.
 *
 * Empty is a real answer, and the caller is expected to fall back to `.agents/skills` rather than
 * install nothing: a project with no agent configured yet is the normal case for a first run, and
 * `.agents/` is the location the most tools read.
 */
export function detectTargets(cwd) {
  return TARGETS.filter((target) => target.detect(cwd));
}
