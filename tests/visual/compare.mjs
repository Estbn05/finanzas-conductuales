// Diffs two capture.mjs runs: every element's computed style, scenario by scenario.
//   node tests/visual/compare.mjs <before-dir> <after-dir> [--limit N]
// Exit code 1 when anything differs. Differences are grouped by (property, before, after)
// so one CSS change that touches 200 elements reads as one line with a count.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const [beforeDir, afterDir] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const limitIndex = process.argv.indexOf("--limit");
const limit = limitIndex > 0 ? Number(process.argv[limitIndex + 1]) : 12;

const files = (await readdir(beforeDir)).filter((f) => f.endsWith(".json")).sort();
let changedScenarios = 0;
const missing = [];

for (const file of files) {
  let after;
  try {
    after = JSON.parse(await readFile(join(afterDir, file), "utf8"));
  } catch {
    missing.push(file);
    continue;
  }
  const before = JSON.parse(await readFile(join(beforeDir, file), "utf8"));
  const groups = new Map();
  const add = (key, element) => {
    const entry = groups.get(key) || { count: 0, examples: [] };
    entry.count += 1;
    if (entry.examples.length < 2) entry.examples.push(element);
    groups.set(key, entry);
  };
  for (const element of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[element];
    const b = after[element];
    if (!a || !b) {
      add(a ? "element removed" : "element added", element);
      continue;
    }
    for (const prop of Object.keys(a)) {
      if (a[prop] !== b[prop]) add(`${prop}: ${a[prop]}  ->  ${b[prop]}`, element);
    }
  }
  if (!groups.size) continue;
  changedScenarios += 1;
  console.log(`\n## ${file.replace(".json", "")}`);
  [...groups.entries()]
    .sort((x, y) => y[1].count - x[1].count)
    .slice(0, limit)
    .forEach(([key, { count, examples }]) => {
      const short = examples.map((e) => e.split(">").slice(-2).join(">"));
      console.log(`  ${count}x ${key}\n       e.g. ${short.join("  |  ")}`);
    });
  if (groups.size > limit) console.log(`  ... ${groups.size - limit} more`);
}

console.log(`\n${changedScenarios} of ${files.length} scenarios differ${missing.length ? `; missing in after: ${missing.join(", ")}` : ""}`);
process.exitCode = changedScenarios || missing.length ? 1 : 0;
