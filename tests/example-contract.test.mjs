import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

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

test("malformed JSON in skill.json is reported as a violation, not thrown", () => {
  const dir = makeExample((files) => { files["skill.json"] = "{ not json"; });

  assert.ok(rules(dir).includes("invalid-json"));
});

test("malformed JSON in package.json is reported as a violation, not thrown", () => {
  const dir = makeExample((files) => { files["package.json"] = "{ not json"; });

  assert.ok(rules(dir).includes("invalid-json"));
});

test("malformed JSON in tsconfig.json is reported as a violation, not thrown", () => {
  const dir = makeExample((files) => { files["tsconfig.json"] = "{ not json"; });

  assert.ok(rules(dir).includes("invalid-json"));
});

test("an example directory with nothing in it reports every missing file and does not throw", () => {
  const empty = mkdtempSync(join(tmpdir(), "theokit-empty-example-"));
  const found = checkExample(empty);

  assert.ok(found.length > 0);
  assert.ok(found.every((violation) => typeof violation.rule === "string"));
  assert.ok(found.some((violation) => violation.rule === "required-files"));
});

test("a manifest id with no matching region in the code is reported", () => {
  const dir = makeExample((files) => {
    const manifest = JSON.parse(files["skill.json"]);
    manifest.regions.push({ id: "never-written", explains: "x" });
    files["skill.json"] = JSON.stringify(manifest);
  });

  assert.ok(rules(dir).includes("region-missing"));
});

test("a region in the code with no manifest entry is reported", () => {
  const dir = makeExample((files) => {
    files["src/cli.ts"] += "\n// #region skill:undeclared\nconst a = 1;\n// #endregion\n";
  });

  assert.ok(rules(dir).includes("region-undeclared"));
});

test("the same region id in two files is reported", () => {
  const dir = makeExample((files) => {
    files["src/other.ts"] = files["src/cli.ts"];
  });

  assert.ok(rules(dir).includes("region-duplicate"));
});

test("a region outside src/ is reported", () => {
  const dir = makeExample((files) => {
    files["helper.ts"] = files["src/cli.ts"];
  });

  assert.ok(rules(dir).includes("region-location"));
});

test("a manifest id opened only outside src/ still counts as missing", () => {
  const dir = makeExample((files) => {
    files["helper.ts"] = files["src/cli.ts"];
    files["src/cli.ts"] = "const nothing = 1;\n";
  });

  const found = rules(dir);
  assert.ok(found.includes("region-missing"));
  assert.ok(found.includes("region-location"));
});

test("an unclosed region is reported as a violation, not thrown", () => {
  const dir = makeExample((files) => {
    files["src/cli.ts"] = "// #region skill:create-agent-with-memory\nconst a = 1;\n";
  });

  assert.ok(rules(dir).includes("region-syntax"));
});
