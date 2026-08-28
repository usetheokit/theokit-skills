import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import { ManifestError, parseManifest } from "./skill-manifest.mjs";
import { parseRegions, RegionError } from "./regions.mjs";

/** Taken from the map in the theokit-examples README. A closed vocabulary, deliberately. */
export const CATEGORIES = Object.freeze([
  "build-agents",
  "capabilities",
  "connections",
  "extensibility",
  "component-libraries",
  "backend-di",
  "framework-plugins",
]);

const REQUIRED_FILES = [
  "skill.json",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "README.md",
  ".gitignore",
];

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/;

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx"]);

function sourceFiles(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (SOURCE_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) found.push(path);
    }
  };
  walk(dir);
  return found;
}

/**
 * Read and parse one JSON file, reporting malformed syntax as a violation.
 *
 * A file that cannot be parsed is a contract problem like any other, and the caller collects
 * violations rather than throwing: an author fixing an example should see everything that is
 * wrong in one run. Anything that is not a syntax error is a real fault and still propagates.
 */
function readJson(path, add, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    add("invalid-json", `${label} is not valid JSON: ${error.message}`);
    return null;
  }
}

/**
 * Report every way `dir` departs from the example contract.
 *
 * Returns a list rather than throwing on the first problem: an author fixing an example should
 * learn everything that is wrong in one run, not one thing per run.
 */
export function checkExample(dir) {
  const violations = [];
  const add = (rule, message) => violations.push({ rule, message });

  for (const name of REQUIRED_FILES) {
    if (!existsSync(join(dir, name))) add("required-files", `missing ${name}`);
  }

  const slug = basename(dir);
  const category = basename(dirname(dir));
  if (!CATEGORIES.includes(category)) {
    add("category", `"${category}" is not one of: ${CATEGORIES.join(", ")}`);
  }

  let manifest = null;
  if (existsSync(join(dir, "skill.json"))) {
    const raw = readJson(join(dir, "skill.json"), add, "skill.json");
    if (raw !== null) {
      try {
        manifest = parseManifest(raw, join(dir, "skill.json"));
        if (manifest.skill !== `theokit-${slug}`) {
          add("manifest", `skill "${manifest.skill}" does not match directory slug "${slug}"`);
        }
      } catch (error) {
        if (!(error instanceof ManifestError)) throw error;
        add("manifest", error.message);
      }
    }
  }

  if (existsSync(join(dir, "package.json"))) {
    const pkg = readJson(join(dir, "package.json"), add, "package.json");
    if (pkg !== null) {
      if (pkg.name !== `theokit-example-${slug}`) {
        add("package-name", `name must be "theokit-example-${slug}", found "${pkg.name}"`);
      }
      if (pkg.private !== true) add("package-fields", 'must set "private": true');
      if (pkg.type !== "module") add("package-fields", 'must set "type": "module"');

      for (const script of ["start", "typecheck"]) {
        if (typeof pkg.scripts?.[script] !== "string") {
          add("required-scripts", `missing "${script}" script`);
        }
      }

      const allDependencies = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      for (const [name, range] of Object.entries(allDependencies)) {
        if (!name.startsWith("@theokit/")) continue;
        if (!EXACT_VERSION.test(range)) {
          add("exact-pin", `${name} must be pinned exactly, found "${range}"`);
        }
      }
    }
  }

  if (existsSync(join(dir, "tsconfig.json"))) {
    const tsconfig = readJson(join(dir, "tsconfig.json"), add, "tsconfig.json");
    if (tsconfig !== null) {
      if (tsconfig.compilerOptions?.strict !== true) {
        add("strict-typescript", 'tsconfig.json must set "strict": true');
      }
    }
  }

  if (existsSync(join(dir, ".gitignore"))) {
    const ignored = readFileSync(join(dir, ".gitignore"), "utf8");
    for (const entry of ["node_modules/", "dist/"]) {
      if (!ignored.includes(entry)) add("gitignore", `must ignore ${entry}`);
    }
  }

  const seen = new Map();
  for (const path of sourceFiles(dir)) {
    const relativePath = relative(dir, path).split("\\").join("/");
    let parsed;
    try {
      parsed = parseRegions(readFileSync(path, "utf8"), relativePath);
    } catch (error) {
      if (!(error instanceof RegionError)) throw error;
      add("region-syntax", error.message);
      continue;
    }

    for (const region of parsed) {
      if (!relativePath.startsWith("src/")) {
        add("region-location", `region "${region.id}" is in ${relativePath}; regions live under src/`);
      }
      const previous = seen.get(region.id);
      if (previous !== undefined) {
        add("region-duplicate", `region "${region.id}" appears in ${previous} and ${relativePath}`);
      } else {
        seen.set(region.id, relativePath);
      }
    }
  }

  if (manifest !== null) {
    for (const region of manifest.regions) {
      if (!seen.has(region.id)) {
        add("region-missing", `skill.json declares "${region.id}", which no source file opens`);
      }
    }
    const declared = new Set(manifest.regions.map((region) => region.id));
    for (const [id, file] of seen) {
      if (!declared.has(id)) {
        add("region-undeclared", `${file} opens "${id}", which skill.json does not declare`);
      }
    }
  }

  return violations;
}
