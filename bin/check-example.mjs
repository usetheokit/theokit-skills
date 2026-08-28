#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

import { checkExample } from "../lib/example-contract.mjs";

/** An example is any directory holding a skill.json. That is the whole discovery rule. */
function findExamples(root) {
  const found = [];
  const walk = (current) => {
    if (existsSync(join(current, "skill.json"))) found.push(current);
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
    }
  };
  walk(root);
  return found.sort();
}

const root = resolve(process.argv[2] ?? ".");

if (!existsSync(root)) {
  console.error(`${root} does not exist`);
  process.exit(1);
}

if (!statSync(root).isDirectory()) {
  console.error(`${root} is not a directory`);
  process.exit(1);
}

const examples = findExamples(root);

if (examples.length === 0) {
  console.error(`no example found under ${root} (an example is a directory containing skill.json)`);
  process.exit(1);
}

let failed = 0;
for (const dir of examples) {
  const name = relative(root, dir).split("\\").join("/") || basename(dir);

  let violations;
  try {
    violations = checkExample(dir);
  } catch (error) {
    // checkExample reports contract problems as violations and re-throws everything else. An
    // I/O fault in one example must not hide the state of every example after it.
    failed += 1;
    console.log(`ERROR ${name}`);
    console.log(`       ${error.message}`);
    continue;
  }

  if (violations.length === 0) {
    console.log(`ok   ${name}`);
    continue;
  }

  failed += 1;
  console.log(`FAIL ${name}`);
  for (const violation of violations) {
    console.log(`       ${violation.rule}: ${violation.message}`);
  }
}

process.exit(failed === 0 ? 0 : 1);
