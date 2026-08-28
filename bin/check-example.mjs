#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { checkExample } from "../lib/example-contract.mjs";

/** An example is any directory holding a skill.json. That is the whole discovery rule. */
function findExamples(root) {
  const found = [];
  const walk = (current) => {
    if (existsSync(join(current, "skill.json"))) {
      found.push(current);
      return;
    }
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
const examples = findExamples(root);

if (examples.length === 0) {
  console.error(`no example found under ${root} (an example is a directory containing skill.json)`);
  process.exit(1);
}

let failed = 0;
for (const dir of examples) {
  const name = relative(root, dir).split("\\").join("/");
  const violations = checkExample(dir);

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
