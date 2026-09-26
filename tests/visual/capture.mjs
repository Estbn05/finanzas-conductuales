// Visual baseline for CSS refactors. For every scenario in harness.mjs saves:
//   <name>.png   full-page screenshot, for a human to look at
//   <name>.json  computed style of every element, for compare.mjs to diff exactly
//
//   node tests/visual/capture.mjs --out <dir> [--only <text>]
//   node tests/visual/compare.mjs <before-dir> <after-dir>
//
// To try a stylesheet change without touching styles.css, see css-check.mjs.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PROPS, forEachScenario, root, snapshot } from "./harness.mjs";

const outIndex = process.argv.indexOf("--out");
const outDir = outIndex > 0 ? process.argv[outIndex + 1] : join(root, "tests/visual/out");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : "";

await mkdir(outDir, { recursive: true });
const failures = await forEachScenario({ only }, async (page, name, scenario) => {
  const styles = await page.evaluate(snapshot, PROPS);
  await writeFile(join(outDir, `${name}.json`), JSON.stringify(styles));
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: !scenario.scroll });
});
console.log(`\n${failures.length ? failures.join("\n") : "all scenarios captured"} -> ${outDir}`);
if (failures.length) process.exitCode = 1;
