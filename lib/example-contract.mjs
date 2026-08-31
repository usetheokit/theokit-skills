import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import { ManifestError, parseManifest } from "./skill-manifest.mjs";
import { parseLessons, LessonError } from "./lessons.mjs";

/**
 * The LAYER an example teaches — the first path segment, and a closed vocabulary.
 *
 * One axis per level: layer above, domain below. `sdk/memory` and `framework/memory` are the same
 * capability proved on both sides, and that pairing needs no field to declare it: same domain,
 * different layer. The vocabulary that came before this mixed the two axes — `capabilities` and
 * `connections` were domains of the SDK, while `component-libraries` and `backend-di` were layers —
 * so "memory, but in the framework" had no place to go, and the name `theokit-memory` was already
 * spent on one of the two sides.
 */
export const CATEGORIES = Object.freeze([
  "sdk",
  "framework",
  "ui",
  "tui",
  "di",
  "plugins",
  "gateways",
]);

/**
 * `framework` examples are whole theokit apps — `app/`, `agents/`, `server/` — so the library
 * anatomy below cannot describe them. Their shape is deliberately unspecified until the first one
 * is written: a rule invented for a case nobody has built yet is a rule that has never been wrong.
 */
const APP_CATEGORIES = new Set(["framework"]);

/**
 * The roles a lesson id may declare, and the teaching order they read in. The prefix is what tells
 * an agent whether it is looking at the smallest thing that works, a variation it may not need, or
 * a mistake it is about to make — without a sentence of prose having to say so.
 */
const LESSON_ROLE = /^(?:minimal|(?:setup|core|variant|pitfall|verify)-[a-z0-9]+(?:-[a-z0-9]+)*)$/;

/** The four fixed files of the library anatomy, and what each one is allowed to open. */
const DRIVER = "src/cli.ts";
const MINIMAL = "src/minimal.ts";
const PITFALLS = "src/pitfalls.ts";

/**
 * The shared machinery sits OUTSIDE `src/`, which is deliberate: the skill generator copies `src/`
 * into the skill's `example.md`, and argument parsing plus a fake HTTP provider teach nothing about
 * the SDK. Keeping them out of `src/` keeps them out of the agent's context, and out of a directory
 * listing where two files named `cli*` made a reader work out which was which.
 */
const RUNTIME_DIR = "runtime";

/**
 * Which canonical files each category must carry. An app has no CLI, so `cli-runtime.ts` would be
 * dead weight in it — but it still has to prove its lessons, so `fake-provider.ts` is required
 * everywhere. Any file present under `runtime/` is checked for drift whether required or not.
 */
const REQUIRED_RUNTIME = { app: ["fake-provider.ts"] };
const RUNTIME = `${RUNTIME_DIR}/cli-runtime.ts`;
const CANONICAL_DIR = ["..", "..", "_driver"];

/** Where the one true copy of the runtime lives, relative to an example directory. */
const CANONICAL_RUNTIME = ["..", "..", "_driver", "cli-runtime.ts"];

const REQUIRED_FILES = [
  "skill.json",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "README.md",
  ".gitignore",
];

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/;

/**
 * Every package of this ecosystem an example may depend on, all of which must be pinned exactly.
 *
 * `theokit` and `create-theokit` carry no scope, so a prefix test on `@theokit/` misses the
 * framework package itself — the one a `framework` example depends on most. Third-party packages
 * are deliberately not covered: pinning React would say nothing about what the reader installs
 * from us.
 */
const ECOSYSTEM_PACKAGE = /^(?:theokit|create-theokit|@theokit\/[a-z0-9-]+|@usetheo\/[a-z0-9-]+)$/;

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
 * The directories an example's lessons may live under, taken from `tsconfig.json`'s `include`.
 *
 * A library example includes `src` and nothing else. A framework example is a whole theokit app
 * and includes `app`, `agents` and `server` — so hard-coding `src/` here would make the lesson
 * markers unusable in exactly the examples that teach the framework. `null` means every path
 * qualifies, which is what a leading glob (`**\/*.ts`) asks for.
 */
function sourceRoots(tsconfig) {
  const include = tsconfig?.include;
  if (!Array.isArray(include) || include.length === 0) return ["src"];

  const roots = [];
  for (const entry of include) {
    if (typeof entry !== "string") continue;
    const first = entry.split("/")[0];
    if (first === "" || first === "." || first.includes("*")) return null;
    roots.push(first);
  }
  return roots.length > 0 ? roots : ["src"];
}

/**
 * Report every way the library anatomy is broken, given which lessons each file opened.
 *
 * The anatomy is four files with four fixed jobs, and it exists so that an agent reading its
 * second example already knows where to look. `cli.ts` ships whole in the generated skill's
 * `example.md` rather than in pieces, so it opens nothing; `minimal.ts` holds the smallest thing
 * that works and nothing else; `pitfalls.ts` holds the mistakes and nothing else; and at least one
 * more file carries the domain itself.
 */
function checkAnatomy(dir, lessonsByFile, add) {
  for (const name of [DRIVER, MINIMAL, PITFALLS, RUNTIME]) {
    if (!existsSync(join(dir, name))) add("anatomy", `missing ${name}`);
  }

  const domainFiles = (existsSync(join(dir, "src")) ? sourceFiles(join(dir, "src")) : [])
    .map((path) => "src/" + relative(join(dir, "src"), path).split("\\").join("/"))
    .filter((path) => ![DRIVER, MINIMAL, PITFALLS].includes(path));
  if (domainFiles.length === 0) {
    add("anatomy", "src/ needs a domain file beside cli.ts, minimal.ts and pitfalls.ts");
  }

  for (const [file, ids] of lessonsByFile) {
    if ((file === DRIVER || file === RUNTIME) && ids.length > 0) {
      add("anatomy", `${file} opens "${ids[0]}"; the driver ships whole, not in lessons`);
    }
    if (file === MINIMAL) {
      for (const id of ids) {
        if (id !== "minimal") add("anatomy", `${MINIMAL} opens "${id}"; it holds only "minimal"`);
      }
    }
    for (const id of ids) {
      const isPitfall = id.startsWith("pitfall-");
      if (isPitfall && file !== PITFALLS) {
        add("anatomy", `lesson "${id}" is in ${file}; pitfalls live in ${PITFALLS}`);
      }
      if (!isPitfall && file === PITFALLS) {
        add("anatomy", `${PITFALLS} opens "${id}", which is not a pitfall`);
      }
    }
  }
}

/**
 * Report a lesson nobody proves.
 *
 * A lesson is code the generator copies verbatim into a skill, so a lesson nobody executes is a
 * claim — and this repository publishes claims to agents that cannot check them. A credential is
 * not an excuse: `_driver/fake-provider.ts` serves the chat-completions protocol on a
 * credential-free provider's port, so a real agent run fits inside a test.
 *
 * HONEST LIMIT: this checks that a test file NAMES each lesson id, not that it asserts anything
 * about it. It catches the lesson somebody forgot, not the assertion somebody wrote badly. A gate
 * that claimed the second would be claiming more than it measures.
 */
function checkProof(dir, manifest, add) {
  const pkg = existsSync(join(dir, "package.json"))
    ? readJson(join(dir, "package.json"), () => {}, "package.json")
    : null;
  if (pkg !== null && typeof pkg.scripts?.test !== "string") {
    add("proof", 'missing "test" script — every lesson needs a test that runs without a credential');
  }

  const testsDir = join(dir, "tests");
  const files = existsSync(testsDir)
    ? readdirSync(testsDir).filter((name) => name.endsWith(".test.ts"))
    : [];
  if (files.length === 0) {
    add("proof", "no tests/*.test.ts — see _driver/fake-provider.ts for running an agent without a key");
    return;
  }

  if (manifest === null) return;

  const prose = files.map((name) => readFileSync(join(testsDir, name), "utf8")).join("\n");
  const unproven = manifest.lessons.map((lesson) => lesson.id).filter((id) => !prose.includes(id));
  if (unproven.length > 0) {
    add("proof", `no test names ${unproven.map((id) => `"${id}"`).join(", ")}`);
  }
}

/**
 * Report any file under `runtime/` that has drifted from its canonical copy in `_driver/`.
 *
 * The shared machinery is copied into every example rather than imported, because an example that
 * resolves a package we invented stops being what a stranger installs. Copying is only safe while
 * the copies are provably identical, so an absent canonical directory is reported rather than
 * quietly skipping the check — a check that disarms itself when its input is missing is worse than
 * no check.
 *
 * Every `.ts` in `_driver/` is compared, so adding a file there ships it to every example on the
 * next `npm run sync` and fails the check until it has been run.
 */
function checkDriverDrift(dir, category, add) {
  const canonicalDir = join(dir, ...CANONICAL_DIR);
  if (!existsSync(canonicalDir)) {
    add("driver-drift", "no canonical _driver/ directory to compare against");
    return;
  }

  const canonical = readdirSync(canonicalDir).filter((name) => name.endsWith(".ts")).sort();
  if (canonical.length === 0) {
    add("driver-drift", "_driver/ holds no canonical file to compare against");
    return;
  }

  const required = APP_CATEGORIES.has(category) ? REQUIRED_RUNTIME.app : canonical;
  for (const name of canonical) {
    const copy = join(dir, RUNTIME_DIR, name);
    if (!existsSync(copy)) {
      if (required.includes(name)) {
        add("driver-drift", `${RUNTIME_DIR}/${name} is missing — run \`npm run sync\``);
      }
      continue;
    }
    if (readFileSync(copy, "utf8") !== readFileSync(join(canonicalDir, name), "utf8")) {
      add("driver-drift", `${RUNTIME_DIR}/${name} differs from _driver/${name} — edit the canonical copy and run \`npm run sync\``);
    }
  }
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
        // The layer is part of the name because a pair shares its domain: `sdk/memory` and
        // `framework/memory` both teach memory, and an agent reading the name has to know which
        // API it is about to be handed.
        const expected = `theokit-${category}-${slug}`;
        if (manifest.skill !== expected) {
          add("manifest", `skill must be "${expected}", found "${manifest.skill}"`);
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
      if (pkg.name !== `theokit-example-${category}-${slug}`) {
        add("package-name", `name must be "theokit-example-${category}-${slug}", found "${pkg.name}"`);
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
        if (!ECOSYSTEM_PACKAGE.test(name)) continue;
        if (!EXACT_VERSION.test(range)) {
          add("exact-pin", `${name} must be pinned exactly, found "${range}"`);
        }
      }
    }
  }

  let roots = ["src"];
  if (existsSync(join(dir, "tsconfig.json"))) {
    const tsconfig = readJson(join(dir, "tsconfig.json"), add, "tsconfig.json");
    if (tsconfig !== null) {
      if (tsconfig.compilerOptions?.strict !== true) {
        add("strict-typescript", 'tsconfig.json must set "strict": true');
      }
      roots = sourceRoots(tsconfig);
    }
  }

  if (existsSync(join(dir, ".gitignore"))) {
    const ignored = readFileSync(join(dir, ".gitignore"), "utf8");
    for (const entry of ["node_modules/", "dist/"]) {
      if (!ignored.includes(entry)) add("gitignore", `must ignore ${entry}`);
    }
  }

  // `seen` covers the whole tree, for the location and duplicate checks. `seenInRoots` covers only
  // lessons under a declared source root, because that is the only place the manifest cross-checks
  // (lesson-missing, lesson-undeclared) are defined to look.
  const seen = new Map();
  const seenInRoots = new Map();
  const lessonsByFile = new Map();
  for (const path of sourceFiles(dir)) {
    const relativePath = relative(dir, path).split("\\").join("/");
    let parsed;
    try {
      parsed = parseLessons(readFileSync(path, "utf8"), relativePath);
    } catch (error) {
      if (!(error instanceof LessonError)) throw error;
      add("lesson-syntax", error.message);
      continue;
    }

    lessonsByFile.set(relativePath, parsed.map((lesson) => lesson.id));

    const inRoots = roots === null || roots.some((root) => relativePath.startsWith(`${root}/`));
    for (const lesson of parsed) {
      if (!inRoots) {
        const where = roots.join(", ");
        add(
          "lesson-location",
          `lesson "${lesson.id}" is in ${relativePath}; lessons live under the directories tsconfig.json includes (${where})`,
        );
      }
      if (!LESSON_ROLE.test(lesson.id)) {
        add(
          "lesson-role",
          `lesson "${lesson.id}" declares no role; ids are "minimal" or <setup|core|variant|pitfall|verify>-<what>`,
        );
      }
      const previous = seen.get(lesson.id);
      if (previous !== undefined) {
        add("lesson-duplicate", `lesson "${lesson.id}" appears in ${previous} and ${relativePath}`);
      } else {
        seen.set(lesson.id, relativePath);
      }
      if (inRoots && !seenInRoots.has(lesson.id)) {
        seenInRoots.set(lesson.id, relativePath);
      }
    }
  }

  if (!APP_CATEGORIES.has(category)) checkAnatomy(dir, lessonsByFile, add);
  checkDriverDrift(dir, category, add);
  checkProof(dir, manifest, add);

  if (manifest !== null) {
    for (const lesson of manifest.lessons) {
      if (!seenInRoots.has(lesson.id)) {
        add("lesson-missing", `skill.json declares "${lesson.id}", which no source file opens`);
      }
    }
    const declared = new Set(manifest.lessons.map((lesson) => lesson.id));
    for (const [id, file] of seenInRoots) {
      if (!declared.has(id)) {
        add("lesson-undeclared", `${file} opens "${id}", which skill.json does not declare`);
      }
    }
  }

  return violations;
}
