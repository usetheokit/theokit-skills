import { test } from "node:test";
import assert from "node:assert/strict";

import { compile, installedTypePaths } from "./_typecheck.mjs";

// The compiler machinery lived inside `api-resolves.test.mjs` — compiler options, an in-memory
// CompilerHost, and a `paths` map built from each installed package's `exports[].types`. B-003 needs
// all three to compile skill EXAMPLES rather than skill IMPORTS. Copying it would produce two
// harnesses that drift apart, which is the defect B-008 spent a cycle removing for import extractors
// and which `tests/extractor-agreement.test.mjs` now forbids by structure.

test("a type error in a synthetic source is reported, with its code", () => {
  const diagnostics = compile({ "a.ts": 'const x: number = "not a number";\n' });

  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 2322);
  assert.equal(diagnostics[0].file, "a.ts");
});

test("a clean source reports nothing", () => {
  assert.deepEqual(compile({ "a.ts": "const x: number = 1;\nexport { x };\n" }), []);
});

test("an installed @theokit subpath resolves — proving `paths` is wired, not merely present", () => {
  // Without the explicit map, npm and pnpm both isolate `node_modules` and the MODULE fails to
  // resolve — which reports every imported name as missing and reads exactly like the defect the
  // sibling gate looks for.
  const paths = installedTypePaths();
  assert.ok(Object.keys(paths).length > 0, "no installed @theokit package has built declarations — run `npm install`");

  const [specifier] = Object.keys(paths).sort();
  const diagnostics = compile({ "a.ts": `import * as m from "${specifier}";\nvoid m;\n` });

  assert.deepEqual(
    diagnostics.map((d) => d.message),
    [],
    `${specifier} did not resolve — the paths map is not reaching the compiler`,
  );
});
