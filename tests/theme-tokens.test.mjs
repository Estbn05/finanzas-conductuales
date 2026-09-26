// The design tokens live in exactly one light block and one dark block, and the theme is
// the one chosen in the app (html[data-theme]). Stylesheet blocks keyed to the phone's
// system theme used to leak: with the app in "Oscuro" and the phone in light mode, the
// date/time icons in form fields were dark on a dark field.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = (await readFile(new URL("../styles.css", import.meta.url), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");

// Top-level blocks whose selector is exactly `selector`.
function blocksFor(selector) {
  const found = [];
  // Walk top-level blocks by brace depth; nested blocks (@media) are skipped whole.
  let depth = 0;
  let preludeStart = 0;
  let bodyStart = -1;
  let current = "";
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "{") {
      if (depth === 0) {
        current = css.slice(preludeStart, i).trim();
        bodyStart = i + 1;
      }
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        if (current === selector) {
          const body = css.slice(bodyStart, i);
          found.push(Object.fromEntries(
            body.split(";").map((d) => d.split(":")).filter((pair) => pair.length >= 2).map(([k, ...v]) => [k.trim(), v.join(":").trim()])
          ));
        }
        preludeStart = i + 1;
      }
    }
  }
  return found;
}

const [light] = blocksFor(":root");
const [darkOverrides] = blocksFor('html[data-theme="dark"]');
const dark = { ...light, ...darkOverrides };

function resolve(tokens, value) {
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  return ref ? resolve(tokens, tokens[ref[1]]) : value;
}

function luminance(hex) {
  const channels = hex.replace("#", "").match(/../g).map((c) => parseInt(c, 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("one light and one dark token block, nothing keyed to the system theme", () => {
  assert.equal(blocksFor(":root").length, 1);
  assert.equal(blocksFor('html[data-theme="dark"]').length, 1);
  assert.equal(/@media\s*\(prefers-color-scheme/.test(css), false);
  assert.equal(light["color-scheme"], "light");
  assert.equal(dark["color-scheme"], "dark");
});

test("every token the dark theme overrides exists in the light theme", () => {
  for (const name of Object.keys(darkOverrides).filter((k) => k.startsWith("--"))) {
    assert.ok(name in light, `${name} is only defined for dark`);
  }
});

test("form fields stay readable in both themes", () => {
  for (const [name, tokens] of [["light", light], ["dark", dark]]) {
    const text = resolve(tokens, tokens["--field-text"]);
    const background = resolve(tokens, tokens["--field-bg"]);
    assert.ok(contrast(text, background) >= 4.5, `${name}: field text ${text} on ${background}`);
  }
  assert.equal(light["--field-icon-filter"], "none");
  assert.match(dark["--field-icon-filter"], /invert/);
});

test("body text and muted text meet WCAG AA on the page background in both themes", () => {
  for (const [name, tokens] of [["light", light], ["dark", dark]]) {
    const bg = resolve(tokens, tokens["--ds-bg"]);
    for (const token of ["--ds-ink", "--ds-muted"]) {
      const fg = resolve(tokens, tokens[token]);
      assert.ok(contrast(fg, bg) >= 4.5, `${name}: ${token} ${fg} on ${bg}`);
    }
  }
});
