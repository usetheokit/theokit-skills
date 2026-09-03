import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
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
      name: "theokit-example-sdk-memory",
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
      name: "theokit-example-sdk-memory",
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

test("a manifest id with no matching lesson in the code is reported", () => {
  const dir = makeExample((files) => {
    const manifest = JSON.parse(files["skill.json"]);
    manifest.lessons.push({ id: "never-written", explains: "x" });
    files["skill.json"] = JSON.stringify(manifest);
  });

  assert.ok(rules(dir).includes("lesson-missing"));
});

test("a lesson in the code with no manifest entry is reported", () => {
  const dir = makeExample((files) => {
    files["src/memory.ts"] += "\n// #region lesson:core-undeclared\nconst a = 1;\n// #endregion\n";
  });

  assert.ok(rules(dir).includes("lesson-undeclared"));
});

test("the same lesson id in two files is reported", () => {
  const dir = makeExample((files) => {
    files["src/other.ts"] = files["src/memory.ts"];
  });

  assert.ok(rules(dir).includes("lesson-duplicate"));
});

test("a lesson outside the directories tsconfig includes is reported", () => {
  const dir = makeExample((files) => {
    files["helper.ts"] = files["src/memory.ts"];
  });

  assert.ok(rules(dir).includes("lesson-location"));
});

test("a manifest id opened only outside src/ still counts as missing", () => {
  const dir = makeExample((files) => {
    files["helper.ts"] = files["src/memory.ts"];
    files["src/memory.ts"] = "const nothing = 1;\n";
  });

  const found = rules(dir);
  assert.ok(found.includes("lesson-missing"));
  assert.ok(found.includes("lesson-location"));
});

test("an unclosed lesson is reported as a violation, not thrown", () => {
  const dir = makeExample((files) => {
    files["src/memory.ts"] = "// #region lesson:core-enable-memory\nconst a = 1;\n";
  });

  assert.ok(rules(dir).includes("lesson-syntax"));
});

test("a library example missing src/minimal.ts is reported", () => {
  const dir = makeExample((files) => {
    files["src/minimal.ts"] = null;
    const manifest = JSON.parse(files["skill.json"]);
    manifest.lessons = manifest.lessons.filter((lesson) => lesson.id !== "minimal");
    files["skill.json"] = JSON.stringify(manifest);
  });

  assert.ok(rules(dir).includes("anatomy"));
});

test("a library example missing src/pitfalls.ts is reported", () => {
  const dir = makeExample((files) => {
    files["src/pitfalls.ts"] = null;
    const manifest = JSON.parse(files["skill.json"]);
    manifest.lessons = manifest.lessons.filter((lesson) => !lesson.id.startsWith("pitfall-"));
    files["skill.json"] = JSON.stringify(manifest);
  });

  assert.ok(rules(dir).includes("anatomy"));
});

test("a library example with no domain file beside the three fixed ones is reported", () => {
  const dir = makeExample((files) => {
    files["src/memory.ts"] = null;
    const manifest = JSON.parse(files["skill.json"]);
    manifest.lessons = manifest.lessons.filter((lesson) => lesson.id !== "core-enable-memory");
    files["skill.json"] = JSON.stringify(manifest);
  });

  assert.ok(rules(dir).includes("anatomy"));
});

test("a driver that opens a lesson is reported, because the driver ships whole rather than in pieces", () => {
  const dir = makeExample((files) => {
    files["src/cli.ts"] = "// #region lesson:core-run\nawait main();\n// #endregion\n";
    const manifest = JSON.parse(files["skill.json"]);
    manifest.lessons.push({ id: "core-run", explains: "x" });
    files["skill.json"] = JSON.stringify(manifest);
  });

  assert.ok(rules(dir).includes("anatomy"));
});

test("a minimal.ts holding anything but the minimal lesson is reported", () => {
  const dir = makeExample((files) => {
    files["src/minimal.ts"] += "\n// #region lesson:core-extra\nconst a = 1;\n// #endregion\n";
    const manifest = JSON.parse(files["skill.json"]);
    manifest.lessons.push({ id: "core-extra", explains: "x" });
    files["skill.json"] = JSON.stringify(manifest);
  });

  assert.ok(rules(dir).includes("anatomy"));
});

test("a pitfall lesson outside pitfalls.ts is reported", () => {
  const dir = makeExample((files) => {
    files["src/memory.ts"] += "\n// #region lesson:pitfall-elsewhere\nconst a = 1;\n// #endregion\n";
    const manifest = JSON.parse(files["skill.json"]);
    manifest.lessons.push({ id: "pitfall-elsewhere", explains: "x" });
    files["skill.json"] = JSON.stringify(manifest);
  });

  assert.ok(rules(dir).includes("anatomy"));
});

test("a non-pitfall lesson inside pitfalls.ts is reported", () => {
  const dir = makeExample((files) => {
    files["src/pitfalls.ts"] += "\n// #region lesson:core-strays\nconst a = 1;\n// #endregion\n";
    const manifest = JSON.parse(files["skill.json"]);
    manifest.lessons.push({ id: "core-strays", explains: "x" });
    files["skill.json"] = JSON.stringify(manifest);
  });

  assert.ok(rules(dir).includes("anatomy"));
});

test("a lesson id that declares no teaching role is reported", () => {
  const dir = makeExample((files) => {
    files["src/memory.ts"] = "// #region lesson:enable-memory\nconst a = 1;\n// #endregion\n";
    const manifest = JSON.parse(files["skill.json"]);
    manifest.lessons = manifest.lessons.map((lesson) =>
      lesson.id === "core-enable-memory" ? { id: "enable-memory", explains: "x" } : lesson,
    );
    files["skill.json"] = JSON.stringify(manifest);
  });

  assert.ok(rules(dir).includes("lesson-role"));
});

test("a bare role prefix with nothing after it is reported", () => {
  const dir = makeExample((files) => {
    files["src/memory.ts"] = "// #region lesson:core\nconst a = 1;\n// #endregion\n";
    const manifest = JSON.parse(files["skill.json"]);
    manifest.lessons = manifest.lessons.map((lesson) =>
      lesson.id === "core-enable-memory" ? { id: "core", explains: "x" } : lesson,
    );
    files["skill.json"] = JSON.stringify(manifest);
  });

  assert.ok(rules(dir).includes("lesson-role"));
});

test("the framework category is accepted, and the library anatomy does not apply to it", () => {
  const dir = makeExample((files) => {
    files["src/minimal.ts"] = null;
    files["src/pitfalls.ts"] = null;
    const manifest = JSON.parse(files["skill.json"]);
    manifest.lessons = manifest.lessons.filter((lesson) => lesson.id === "core-enable-memory");
    files["skill.json"] = JSON.stringify(manifest);
  });
  const moved = join(dirname(dirname(dir)), "framework", "memory");
  mkdirSync(dirname(moved), { recursive: true });
  renameSync(dir, moved);

  const found = rules(moved);
  assert.ok(!found.includes("category"));
  assert.ok(!found.includes("anatomy"));
});

test("a lesson under a directory tsconfig includes is not a location violation", () => {
  const dir = makeExample((files) => {
    files["tsconfig.json"] = JSON.stringify({
      compilerOptions: { strict: true },
      include: ["agents", "server"],
    });
    files["agents/chat.ts"] = files["src/memory.ts"];
    files["src/memory.ts"] = null;
    files["src/minimal.ts"] = null;
    files["src/pitfalls.ts"] = null;
    const manifest = JSON.parse(files["skill.json"]);
    manifest.lessons = manifest.lessons.filter((lesson) => lesson.id === "core-enable-memory");
    files["skill.json"] = JSON.stringify(manifest);
  });
  const moved = join(dirname(dirname(dir)), "framework", "memory");
  mkdirSync(dirname(moved), { recursive: true });
  renameSync(dir, moved);

  const found = rules(moved);
  assert.ok(!found.includes("lesson-location"));
  assert.ok(!found.includes("lesson-missing"));
});

test("a driver runtime that diverges from the canonical copy is reported", () => {
  const dir = makeExample((files) => {
    files["runtime/cli-runtime.ts"] = "export async function runCli() { /* edited here */ }\n";
  });

  assert.ok(rules(dir).includes("driver-drift"));
});

test("a missing runtime/cli-runtime.ts is an anatomy violation, not a silent pass", () => {
  const dir = makeExample((files) => { files["runtime/cli-runtime.ts"] = null; });

  assert.ok(rules(dir).includes("anatomy"));
});

test("an absent canonical runtime is reported rather than disarming the check", () => {
  const dir = makeExample();
  rmSync(join(dirname(dirname(dir)), "_driver"), { recursive: true, force: true });

  assert.ok(rules(dir).includes("driver-drift"));
});

test("a driver runtime that opens a lesson is reported", () => {
  const dir = makeExample((files) => {
    const opened = "// #region lesson:core-runtime\nconst a = 1;\n// #endregion\n";
    files["runtime/cli-runtime.ts"] += opened;
    const manifest = JSON.parse(files["skill.json"]);
    manifest.lessons.push({ id: "core-runtime", explains: "x" });
    files["skill.json"] = JSON.stringify(manifest);
  });

  assert.ok(rules(dir).includes("anatomy"));
});

test("a ranged `theokit` dependency is reported — the framework package has no @theokit/ prefix", () => {
  const dir = makeExample((files) => {
    const pkg = JSON.parse(files["package.json"]);
    pkg.dependencies = { theokit: "^0.59.0" };
    files["package.json"] = JSON.stringify(pkg);
  });

  assert.ok(rules(dir).includes("exact-pin"));
});

test("a ranged `@usetheo/ui` dependency is reported", () => {
  const dir = makeExample((files) => {
    const pkg = JSON.parse(files["package.json"]);
    pkg.dependencies = { "@theokit/sdk": "4.61.0", "@usetheo/ui": "^0.35.4" };
    files["package.json"] = JSON.stringify(pkg);
  });

  assert.ok(rules(dir).includes("exact-pin"));
});

test("a third-party dependency may still carry a range", () => {
  const dir = makeExample((files) => {
    const pkg = JSON.parse(files["package.json"]);
    pkg.dependencies = { "@theokit/sdk": "4.61.0", react: "^19.0.0" };
    files["package.json"] = JSON.stringify(pkg);
  });

  assert.ok(!rules(dir).includes("exact-pin"));
});

test("every canonical file is checked, not only the first one", () => {
  const dir = makeExample((files) => {
    files["runtime/fake-provider.ts"] = "export async function startFakeProvider() { /* edited */ }\n";
  });

  assert.ok(rules(dir).includes("driver-drift"));
});

test("a canonical file the example never copied is reported", () => {
  const dir = makeExample((files) => { files["runtime/fake-provider.ts"] = null; });

  assert.ok(rules(dir).includes("driver-drift"));
});

test("an example with no test script is reported", () => {
  const dir = makeExample((files) => {
    const pkg = JSON.parse(files["package.json"]);
    delete pkg.scripts.test;
    files["package.json"] = JSON.stringify(pkg);
  });

  assert.ok(rules(dir).includes("proof"));
});

test("an example with a test script but no test file is reported", () => {
  const dir = makeExample((files) => { files["tests/example.test.ts"] = null; });

  assert.ok(rules(dir).includes("proof"));
});

test("a lesson no test names is reported, by name", () => {
  const dir = makeExample((files) => {
    files["tests/example.test.ts"] =
      'test("lesson minimal: works", () => {});\ntest("lesson core-enable-memory: works", () => {});';
  });

  const found = checkExample(dir).filter((violation) => violation.rule === "proof");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /pitfall-send-returns-handle/);
});

test("a framework example's fake provider is checked for drift too", () => {
  const dir = makeExample((files) => {
    files["runtime/fake-provider.ts"] = "export async function startFakeProvider() { /* edited */ }\n";
  });
  const moved = join(dirname(dirname(dir)), "framework", "memory");
  mkdirSync(dirname(moved), { recursive: true });
  renameSync(dir, moved);

  assert.ok(rules(moved).includes("driver-drift"));
});

test("a framework example needs no cli-runtime, because it has no CLI", () => {
  const dir = makeExample((files) => { files["runtime/cli-runtime.ts"] = null; });
  const moved = join(dirname(dirname(dir)), "framework", "memory");
  mkdirSync(dirname(moved), { recursive: true });
  renameSync(dir, moved);

  assert.ok(!rules(moved).includes("driver-drift"));
});

test("a framework example without the fake provider cannot prove anything", () => {
  const dir = makeExample((files) => { files["runtime/fake-provider.ts"] = null; });
  const moved = join(dirname(dirname(dir)), "framework", "memory");
  mkdirSync(dirname(moved), { recursive: true });
  renameSync(dir, moved);

  assert.ok(rules(moved).includes("driver-drift"));
});

test("the skill name must carry the layer, so a pair does not collide", () => {
  const dir = makeExample((files) => {
    const manifest = JSON.parse(files["skill.json"]);
    manifest.skill = "theokit-memory";
    files["skill.json"] = JSON.stringify(manifest);
  });

  const found = checkExample(dir).filter((v) => v.rule === "manifest");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /theokit-sdk-memory/);
});

test("the package name carries the layer too", () => {
  const dir = makeExample((files) => {
    const pkg = JSON.parse(files["package.json"]);
    pkg.name = "theokit-example-memory";
    files["package.json"] = JSON.stringify(pkg);
  });

  assert.ok(rules(dir).includes("package-name"));
});

test("the layer vocabulary is closed", () => {
  const dir = makeExample();
  const moved = join(dirname(dirname(dir)), "capabilities", "memory");
  mkdirSync(dirname(moved), { recursive: true });
  renameSync(dir, moved);

  assert.ok(rules(moved).includes("category"));
});

/*
 * usetheokit/theokit-skills#24 — a snapshot version can be committed as a permanent example pin.
 *
 * `theokit-examples/README.md` opens with the repository's promise: *"Every example installs
 * theokit from npm, at a pinned version, exactly as a stranger would."* A stranger does not
 * install a throwaway snapshot.
 *
 * Harmless until `usetheokit/theokit-sdk#484` gave the SDK a snapshot release path. The intended
 * workflow is publish a snapshot, verify against it, then pin the real release — and nothing made
 * the last step happen. npm versions are immutable after 72 hours, so a snapshot left behind keeps
 * resolving forever and the example demonstrates a tree that was never released.
 */
test("a changesets snapshot pin is reported — it is a throwaway version, not a release", () => {
  const dir = makeExample((files) => {
    const pkg = JSON.parse(files["package.json"]);
    pkg.dependencies = { theokit: "0.64.1-pr479-20260831130000" };
    files["package.json"] = JSON.stringify(pkg);
  });

  assert.ok(rules(dir).includes("exact-pin"));
});

test("a released prerelease still passes — beta and rc are versions a stranger can install", () => {
  // The counter-proof, and the line this fix deliberately does not cross. `EXAMPLE-CONTRACT.md`
  // lists `4.61.0-beta.1` as valid, and refusing every prerelease would refuse a published beta an
  // example may be pinned to on purpose during a migration. What is refused is the SHAPE a
  // changesets snapshot has and nothing else does: a trailing 14-digit UTC timestamp.
  for (const version of ["4.61.0-beta.1", "4.61.0-rc.2", "4.63.4-next.0", "4.61.0"]) {
    const dir = makeExample((files) => {
      const pkg = JSON.parse(files["package.json"]);
      pkg.dependencies = { "@theokit/sdk": version };
      files["package.json"] = JSON.stringify(pkg);
    });

    assert.ok(!rules(dir).includes("exact-pin"), `${version} should be an acceptable pin`);
  }
});

test("the snapshot shape is recognised whatever tag the dispatch chose", () => {
  // `changeset version --snapshot <tag>` takes the tag from the dispatch input, so the middle
  // segment is whatever someone typed. Matching `pr479` would close the hole for one workflow and
  // leave it open for the next.
  for (const version of ["0.0.0-fix-20260901120000", "1.2.3-my.branch-20260902235959"]) {
    const dir = makeExample((files) => {
      const pkg = JSON.parse(files["package.json"]);
      pkg.dependencies = { "@theokit/sdk": version };
      files["package.json"] = JSON.stringify(pkg);
    });

    assert.ok(rules(dir).includes("exact-pin"), `${version} should be refused`);
  }
});
