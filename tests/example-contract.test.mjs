import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

import { checkExample } from "../lib/example-contract.mjs";
import { makeExample } from "./_fixture.mjs";

function rules(dir) {
  return checkExample(dir).map((violation) => violation.rule);
}

test("a conformant example reports no violations", () => {
  assert.deepEqual(checkExample(makeExample()), []);
});

test("a missing README is reported, because the repository promises each example names its credentials", () => {
  assert.ok(rules(makeExample((files) => { files["README.md"] = null; })).includes("required-files"));
});

test("a ranged @theokit dependency is reported", () => {
  const dir = makeExample((files) => {
    files["package.json"] = JSON.stringify({
      name: "theokit-example-memory",
      private: true,
      type: "module",
      scripts: { start: "tsx src/cli.ts", typecheck: "tsc --noEmit" },
      dependencies: { "@theokit/sdk": "^4.61.0" },
    });
  });

  assert.ok(rules(dir).includes("exact-pin"));
});

test("a @theokit dependency resolved through a local path is reported", () => {
  const dir = makeExample((files) => {
    files["package.json"] = JSON.stringify({
      name: "theokit-example-memory",
      private: true,
      type: "module",
      scripts: { start: "tsx src/cli.ts", typecheck: "tsc --noEmit" },
      dependencies: { "@theokit/sdk": "file:../../../theokit-sdk/packages/sdk" },
    });
  });

  assert.ok(rules(dir).includes("exact-pin"));
});

test("a package name that does not match the directory slug is reported", () => {
  const dir = makeExample((files) => {
    const pkg = JSON.parse(files["package.json"]);
    pkg.name = "theokit-example-something-else";
    files["package.json"] = JSON.stringify(pkg);
  });

  assert.ok(rules(dir).includes("package-name"));
});

test("a tsconfig without strict is reported", () => {
  const dir = makeExample((files) => {
    files["tsconfig.json"] = JSON.stringify({ compilerOptions: { strict: false } });
  });

  assert.ok(rules(dir).includes("strict-typescript"));
});

test("a missing typecheck script is reported", () => {
  const dir = makeExample((files) => {
    const pkg = JSON.parse(files["package.json"]);
    delete pkg.scripts.typecheck;
    files["package.json"] = JSON.stringify(pkg);
  });

  assert.ok(rules(dir).includes("required-scripts"));
});

test("a manifest that fails its schema is reported as one violation, not a crash", () => {
  const dir = makeExample((files) => {
    files["skill.json"] = JSON.stringify({ skill: "memory" });
  });

  assert.ok(rules(dir).includes("manifest"));
});

test("a directory outside the category vocabulary is reported", () => {
  const dir = makeExample();
  const moved = join(dirname(dirname(dir)), "misc", "memory");
  mkdirSync(dirname(moved), { recursive: true });
  renameSync(dir, moved);

  assert.ok(rules(moved).includes("category"));
});

test("a @theokit devDependency with a range is reported too", () => {
  const dir = makeExample((files) => {
    const pkg = JSON.parse(files["package.json"]);
    pkg.devDependencies = { "@theokit/sdk-tools": "^0.27.0" };
    files["package.json"] = JSON.stringify(pkg);
  });

  assert.ok(rules(dir).includes("exact-pin"));
});
