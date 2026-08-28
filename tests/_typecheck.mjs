// One TypeScript compiler for the whole suite.
//
// This lived inside `api-resolves.test.mjs`, which compiles the IMPORTS every skill teaches. B-003
// needs the same machinery to compile skill EXAMPLE BODIES. Copying it would have produced two
// harnesses that drift apart — the defect B-008 spent a cycle removing for import extractors, and
// which `tests/extractor-agreement.test.mjs` now forbids by structure. One concern, one
// implementation.
//
// Not a `*.test.mjs` file, so `node --test` does not collect it.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The `@theokit/*` packages present in `node_modules`. */
function installedPackages() {
  const scope = join(root, "node_modules", "@theokit");
  if (!existsSync(scope)) return [];
  return readdirSync(scope).map((name) => `@theokit/${name}`);
}

/**
 * Declared subpath → its built `.d.ts`, for every installed `@theokit` package.
 *
 * The explicit map is load-bearing, not belt-and-braces: npm and pnpm both isolate `node_modules`,
 * so a synthetic source compiled without it cannot resolve the MODULE at all — and an unresolved
 * module reports every imported name as missing, which reads exactly like the defect the sibling
 * gate is looking for.
 */
export function installedTypePaths() {
  const paths = {};
  for (const pkg of installedPackages()) {
    const dir = join(root, "node_modules", ...pkg.split("/"));
    const manifest = join(dir, "package.json");
    if (!existsSync(manifest)) continue;
    const meta = JSON.parse(readFileSync(manifest, "utf8"));
    for (const [sub, condition] of Object.entries(meta.exports ?? {})) {
      const types = condition?.import?.types ?? condition?.types;
      if (typeof types !== "string") continue;
      const file = join(dir, types);
      if (existsSync(file)) paths[sub === "." ? pkg : `${pkg}${sub.slice(1)}`] = [file];
    }
  }
  return paths;
}

/**
 * Compile `sources` — a map of virtual filename to content — and return the diagnostics that belong
 * to those files.
 *
 * `types` defaults to `["node"]` when `@types/node` is installed. Leaving it empty hides the Node
 * globals and produces `TS2591` on every `process` or `require`, which was measured as 68 phantom
 * errors during B-003's discovery: instrument noise indistinguishable from corpus defects unless
 * someone happens to recognise the code.
 */
export function compile(sources, { semanticOnly = false } = {}) {
  const options = {
    noEmit: true,
    strict: false,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: existsSync(join(root, "node_modules", "@types", "node")) ? ["node"] : [],
    baseUrl: root,
    noImplicitAny: false,
    paths: installedTypePaths(),
  };

  const host = ts.createCompilerHost(options, true);
  const readOriginal = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  host.getSourceFile = (name, languageVersion, ...rest) =>
    name in sources
      ? ts.createSourceFile(name, sources[name], languageVersion, true)
      : readOriginal(name, languageVersion, ...rest);
  host.fileExists = (name) => name in sources || fileExists(name);
  host.readFile = (name) => (name in sources ? sources[name] : readFile(name));

  const program = ts.createProgram(Object.keys(sources), options, host);
  const diagnostics = semanticOnly
    ? program.getSemanticDiagnostics()
    : ts.getPreEmitDiagnostics(program);

  return diagnostics
    .filter((d) => d.file !== undefined && d.file.fileName in sources)
    .map((d) => ({
      file: d.file.fileName,
      code: d.code,
      line: d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1,
      message: ts.flattenDiagnosticMessageText(d.messageText, " "),
    }));
}
