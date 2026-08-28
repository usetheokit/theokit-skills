import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MANIFEST = {
  skill: "theokit-memory",
  teaches: ["@theokit/sdk/memory"],
  concept: "Memory that persists across agent runs",
  triggers: ["memory"],
  regions: [{ id: "create-agent-with-memory", explains: "Enabling memory" }],
  notCovered: ["external adapters"],
  credentials: ["ANTHROPIC_API_KEY"],
};

const PACKAGE = {
  name: "theokit-example-memory",
  private: true,
  type: "module",
  scripts: { start: "tsx src/cli.ts", typecheck: "tsc --noEmit" },
  dependencies: { "@theokit/sdk": "4.61.0" },
};

const SOURCE = [
  "// #region skill:create-agent-with-memory",
  "const agent = await Agent.create({ memory: { enabled: true } });",
  "// #endregion",
].join("\n");

/**
 * Write a conformant example into a temp directory, then apply `mutate` to break exactly one rule.
 * Each test asserts one violation, so a fixture that starts conformant keeps every assertion
 * about the rule under test rather than about fixture drift.
 */
export function makeExample(mutate = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "theokit-example-"));
  const dir = join(root, "capabilities", "memory");
  mkdirSync(join(dir, "src"), { recursive: true });

  const files = {
    "skill.json": JSON.stringify(MANIFEST, null, 2),
    "package.json": JSON.stringify(PACKAGE, null, 2),
    "package-lock.json": JSON.stringify({ lockfileVersion: 3 }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }, null, 2),
    "README.md": "# memory\n\nNeeds ANTHROPIC_API_KEY.\n",
    ".gitignore": "node_modules/\ndist/\n",
    "src/cli.ts": SOURCE,
  };

  mutate(files);

  for (const [name, content] of Object.entries(files)) {
    if (content === null) continue;
    writeFileSync(join(dir, name), content);
  }

  return dir;
}
