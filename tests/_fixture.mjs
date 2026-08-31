import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const MANIFEST = {
  skill: "theokit-sdk-memory",
  teaches: ["@theokit/sdk/memory"],
  concept: "Memory that persists across agent runs",
  triggers: ["memory"],
  lessons: [
    { id: "minimal", explains: "The smallest thing that works" },
    { id: "core-enable-memory", explains: "Enabling memory" },
    { id: "pitfall-send-returns-handle", explains: "send() hands back a handle, not the answer" },
  ],
  notCovered: ["external adapters"],
  credentials: ["ANTHROPIC_API_KEY"],
};

const PACKAGE = {
  name: "theokit-example-sdk-memory",
  private: true,
  type: "module",
  scripts: {
    start: "tsx src/cli.ts",
    typecheck: "tsc --noEmit",
    test: "node --import tsx --test tests/*.test.ts",
  },
  dependencies: { "@theokit/sdk": "4.61.0" },
};

const lesson = (id, ...body) => ["// #region lesson:" + id, ...body, "// #endregion"].join("\n");

/** Stands in for the files in `_driver/`; the drift check only cares that the bytes match. */
const RUNTIME = "export async function runCli() {}\n";
const FAKE_PROVIDER = "export async function startFakeProvider() {}\n";

/**
 * Write a conformant example into a temp directory, then apply `mutate` to break exactly one rule.
 * Each test asserts one violation, so a fixture that starts conformant keeps every assertion
 * about the rule under test rather than about fixture drift.
 *
 * The shape here is the library anatomy the contract requires — a driver that opens no lesson, a
 * `minimal.ts` holding only `minimal`, a domain file, and `pitfalls.ts` holding only `pitfall-*`.
 * A test that needs a different shape mutates its way there.
 */
export function makeExample(mutate = () => {}, canonical = undefined) {
  const root = mkdtempSync(join(tmpdir(), "theokit-example-"));
  const dir = join(root, "sdk", "memory");
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(root, "_driver"), { recursive: true });
  writeFileSync(join(root, "_driver", "cli-runtime.ts"), canonical ?? RUNTIME);
  writeFileSync(join(root, "_driver", "fake-provider.ts"), FAKE_PROVIDER);

  const files = {
    "skill.json": JSON.stringify(MANIFEST, null, 2),
    "package.json": JSON.stringify(PACKAGE, null, 2),
    "package-lock.json": JSON.stringify({ lockfileVersion: 3 }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true }, include: ["src", "runtime"] }, null, 2),
    "README.md": "# memory\n\nNeeds ANTHROPIC_API_KEY.\n",
    ".gitignore": "node_modules/\ndist/\n",
    "src/cli.ts": "await runCli({});\n",
    "runtime/cli-runtime.ts": RUNTIME,
    "runtime/fake-provider.ts": FAKE_PROVIDER,
    "tests/example.test.ts": [
      'test("lesson minimal: works", () => {});',
      'test("lesson core-enable-memory: works", () => {});',
      'test("lesson pitfall-send-returns-handle: works", () => {});',
    ].join("\n"),
    "src/minimal.ts": lesson("minimal", "const agent = await Agent.create({ model });"),
    "src/memory.ts": lesson("core-enable-memory", "memory: { enabled: true };"),
    "src/pitfalls.ts": lesson("pitfall-send-returns-handle", "const run = await agent.send(text);"),
  };

  mutate(files);

  for (const [name, content] of Object.entries(files)) {
    if (content === null) continue;
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }

  return dir;
}
