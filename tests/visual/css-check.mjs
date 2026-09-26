// Tries stylesheet candidates against styles.css without touching it. For every
// scenario in harness.mjs it swaps the page's stylesheet in place, compares the computed
// value of EVERY CSS property of every element (and its ::before, ::after, ::placeholder)
// and swaps back, so one page load checks any number of candidates.
//
//   node tests/visual/css-check.mjs <candidate.css> [--only <text>]
//
// Exit code 1 if the candidate renders anything differently. Also exported for tools
// that need per-element attribution (see css-important.mjs).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { forEachScenario, root } from "./harness.mjs";

// ------------------------------------------------------------------ in-page code
// Runs inside the page. Installs window.__css with helpers bound to the live DOM.
function installInPage(original) {
  const PSEUDOS = ["::before", "::after", "::placeholder"];
  const link = document.querySelector('link[rel="stylesheet"][href*="styles.css"]');
  const style = document.createElement("style");
  style.id = "__css-under-test";
  link.after(style);
  link.remove();
  style.textContent = original;
  // Content of a closed <details> gets its size computed lazily, so two identical
  // snapshots disagree. Opening them removes the noise and checks that content too.
  document.querySelectorAll("details").forEach((details) => {
    details.open = true;
  });

  const settle = async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  };

  const targets = () => {
    const list = [];
    for (const el of document.querySelectorAll("html, body, body *")) {
      if (el.closest("script, style, template")) continue;
      list.push([el, ""]);
      for (const pseudo of PSEUDOS) {
        if (pseudo === "::placeholder" && !el.matches("input, textarea")) continue;
        if (pseudo !== "::placeholder") {
          const content = getComputedStyle(el, pseudo).content;
          if (!content || content === "none" || content === "normal") continue;
        }
        list.push([el, pseudo]);
      }
    }
    return list;
  };

  const snap = () => {
    const values = new Map();
    for (const [el, pseudo] of targets()) {
      const cs = getComputedStyle(el, pseudo || null);
      const entry = {};
      for (let i = 0; i < cs.length; i += 1) {
        const prop = cs[i];
        if (prop.startsWith("--") || prop.startsWith("transition") || prop.startsWith("animation")) continue;
        entry[prop] = cs.getPropertyValue(prop);
      }
      let byPseudo = values.get(el);
      if (!byPseudo) values.set(el, (byPseudo = {}));
      byPseudo[pseudo] = entry;
    }
    return values;
  };

  const describe = (el) => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && parts.length < 3; node = node.parentElement) {
      const cls = node.classList.length ? `.${[...node.classList].join(".")}` : "";
      parts.unshift(`${node.tagName.toLowerCase()}${cls}`);
    }
    return parts.join(" > ");
  };

  const diff = (base, next) => {
    const out = [];
    for (const [el, byPseudo] of base) {
      const other = next.get(el) || {};
      for (const [pseudo, entry] of Object.entries(byPseudo)) {
        const otherEntry = other[pseudo];
        if (!otherEntry) {
          out.push({ el, pseudo, prop: "(pseudo-element gone)", before: "", after: "" });
          continue;
        }
        for (const [prop, value] of Object.entries(entry)) {
          if (otherEntry[prop] !== value) out.push({ el, pseudo, prop, before: value, after: otherEntry[prop] });
        }
      }
    }
    for (const [el, byPseudo] of next) {
      for (const pseudo of Object.keys(byPseudo)) {
        if (!base.get(el)?.[pseudo]) out.push({ el, pseudo, prop: "(pseudo-element added)", before: "", after: "" });
      }
    }
    return out;
  };

  const FAMILY_EXTRA = {
    inset: ["top", "right", "bottom", "left"],
    gap: ["row-gap", "column-gap"],
    "place-items": ["align-items", "justify-items"],
    "place-content": ["align-content", "justify-content"],
    "place-self": ["align-self", "justify-self"],
    font: ["line-height"],
    "grid-area": ["grid-row", "grid-column"]
  };
  const affects = (declProp, longhand) => {
    if (declProp === longhand) return true;
    if (declProp.split("-")[0] === longhand.split("-")[0]) return true;
    return (FAMILY_EXTRA[declProp] || []).some((p) => longhand.startsWith(p));
  };
  const selectorMatches = (el, pseudo, selector) => {
    const pseudoRe = /::?(before|after|placeholder)\b/;
    const found = pseudoRe.exec(selector);
    if (pseudo) {
      if (!found || `::${found[1]}` !== pseudo) return false;
    } else if (found) {
      return false;
    }
    try {
      return el.matches(selector.replace(/::?(before|after|placeholder)\b/g, "") || "*");
    } catch {
      return false;
    }
  };
  const mediaOk = (media) => !media || media.split(" and @media ").every((m) => {
    const query = m.replace(/^@media\s*/, "").replace(/^@supports.*/, "all");
    try {
      return matchMedia(query).matches;
    } catch {
      return true;
    }
  });

  let base = null;
  window.__css = {
    async init() {
      await settle();
      base = snap();
    },
    // decls: [{ id, selectors, prop, media }] to attribute differences to.
    async check(candidate, decls = []) {
      style.textContent = candidate;
      await settle();
      const differences = diff(base, snap());
      style.textContent = original;
      await settle();
      const blame = new Set();
      for (const d of differences) {
        for (const decl of decls) {
          if (!affects(decl.prop, d.prop) && !d.prop.startsWith("(")) continue;
          if (!mediaOk(decl.media)) continue;
          if (decl.selectors.some((s) => selectorMatches(d.el, d.pseudo, s))) blame.add(decl.id);
        }
      }
      return {
        count: differences.length,
        sample: differences.slice(0, 8).map((d) => `${describe(d.el)}${d.pseudo} ${d.prop}: ${d.before} -> ${d.after}`),
        blame: [...blame]
      };
    },
    // Which declarations apply to at least one element here (their media matches and a
    // selector matches something, pseudo-elements included).
    coverage(decls) {
      const hit = [];
      for (const decl of decls) {
        if (!mediaOk(decl.media)) continue;
        const matches = decl.selectors.some((s) => {
          try {
            return document.querySelector(s.replace(/::?(before|after|placeholder)\b/g, "") || "*") !== null;
          } catch {
            return false;
          }
        });
        if (matches) hit.push(decl.id);
      }
      return hit;
    }
  };
}

// ------------------------------------------------------------------ node side
// candidatesFor(scenarioName) -> [{ label, css, decls }]; onResult(name, label, result).
export async function runChecks({ only = "", candidatesFor, coverageDecls = [], onResult, onCoverage }) {
  const original = await readFile(join(root, "styles.css"), "utf8");
  return forEachScenario({ only }, async (page, name) => {
    await page.evaluate(installInPage, original);
    await page.evaluate(() => window.__css.init());
    if (coverageDecls.length && onCoverage) {
      onCoverage(name, await page.evaluate((decls) => window.__css.coverage(decls), coverageDecls));
    }
    for (const { label, css, decls = [] } of candidatesFor(name)) {
      const result = await page.evaluate(([candidate, list]) => window.__css.check(candidate, list), [css, decls]);
      onResult(name, label, result);
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : "";
  const candidate = await readFile(file, "utf8");
  let differing = 0;
  const failures = await runChecks({
    only,
    candidatesFor: () => [{ label: "candidate", css: candidate }],
    onResult(name, _label, result) {
      if (!result.count) return;
      differing += 1;
      console.log(`\n## ${name}: ${result.count} differences`);
      result.sample.forEach((line) => console.log(`  ${line}`));
    }
  });
  console.log(`\n${differing} scenario(s) differ${failures.length ? `; failed: ${failures.join(", ")}` : ""}`);
  process.exitCode = differing || failures.length ? 1 : 0;
}
