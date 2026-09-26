// Minimal CSS scanner for styles.css: every declaration with its selectors, @media
// condition and exact character range, so tools can rewrite single declarations.
export function scanDeclarations(css) {
  return scan(css).decls;
}

// Every style rule: selectors, @media condition, [start, end) of the whole rule (prelude
// to closing brace) and its declarations.
export function scanRules(css) {
  return scan(css).rules;
}

function scan(css) {
  const out = [];
  const rules = [];
  const len = css.length;
  let i = 0;
  const stack = []; // { kind: "media" | "rule" | "opaque", text }

  const skipComment = (at) => css.indexOf("*/", at + 2) + 2;

  let preludeStart = 0;
  while (i < len) {
    if (css.startsWith("/*", i)) {
      i = skipComment(i);
      continue;
    }
    const ch = css[i];
    if (ch === "{") {
      const prelude = css.slice(preludeStart, i).replace(/\/\*[\s\S]*?\*\//g, "").trim();
      const parent = stack[stack.length - 1];
      if (parent && parent.kind === "opaque") {
        stack.push({ kind: "opaque", text: prelude });
      } else if (/^@(media|supports)\b/.test(prelude)) {
        stack.push({ kind: "media", text: prelude });
      } else if (prelude.startsWith("@")) {
        stack.push({ kind: "opaque", text: prelude });
      } else {
        stack.push({ kind: "rule", text: prelude, bodyStart: i + 1 });
        const firstDecl = out.length;
        const ruleStart = css.slice(preludeStart, i).search(/\S/) + preludeStart;
        i = scanBody(i + 1, prelude);
        if (!stack.some((s) => s.kind === "opaque")) {
          rules.push({
            selectors: splitSelectors(prelude),
            media: stack.filter((s) => s.kind === "media").map((s) => s.text).join(" and ") || "",
            start: skipLeadingComments(ruleStart),
            bodyStart: css.indexOf("{", ruleStart) + 1,
            end: i,
            decls: out.slice(firstDecl)
          });
        }
        stack.pop();
        preludeStart = i;
        continue;
      }
      i += 1;
      preludeStart = i;
      continue;
    }
    if (ch === "}") {
      stack.pop();
      i += 1;
      preludeStart = i;
      continue;
    }
    i += 1;
  }
  return { decls: out, rules };

  function skipLeadingComments(at) {
    let k = at;
    while (css.startsWith("/*", k)) {
      k = skipComment(k);
      while (/\s/.test(css[k])) k += 1;
    }
    return k;
  }

  // Reads declarations up to the rule's closing brace; returns the index after it.
  function scanBody(start, prelude) {
    const media = stack.filter((s) => s.kind === "media").map((s) => s.text).join(" and ") || "";
    const opaque = stack.some((s) => s.kind === "opaque");
    const selectors = splitSelectors(prelude);
    let j = start;
    let declStart = start;
    let depth = 0;
    let quote = "";
    for (; j < len; j += 1) {
      if (!quote && css.startsWith("/*", j)) {
        j = skipComment(j) - 1;
        continue;
      }
      const c = css[j];
      if (quote) {
        if (c === "\\") j += 1;
        else if (c === quote) quote = "";
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === "(") depth += 1;
      else if (c === ")") depth -= 1;
      else if ((c === ";" || c === "}") && depth === 0) {
        record(declStart, j);
        declStart = j + 1;
        if (c === "}") return j + 1;
      }
    }
    return j;

    function record(from, to) {
      const raw = css.slice(from, to);
      const text = raw.replace(/\/\*[\s\S]*?\*\//g, "");
      const colon = text.indexOf(":");
      if (colon < 0) return;
      const prop = text.slice(0, colon).trim().toLowerCase();
      if (!prop) return;
      const importantMatch = /\s*!\s*important\s*$/i.exec(raw.replace(/\/\*[\s\S]*?\*\/\s*$/g, ""));
      const decl = {
        id: out.length,
        prop,
        value: text.slice(colon + 1).replace(/!\s*important/i, "").trim(),
        selectors,
        media,
        opaque,
        start: from,
        end: to,
        important: Boolean(importantMatch)
      };
      if (importantMatch) {
        decl.importantStart = from + importantMatch.index;
        decl.importantEnd = from + importantMatch.index + importantMatch[0].length;
      }
      out.push(decl);
    }
  }
}

export function splitSelectors(prelude) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of prelude) {
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// Removes the character ranges [start, end) from css.
export function cutRanges(css, ranges) {
  let result = css;
  for (const [start, end] of [...ranges].sort((a, b) => b[0] - a[0])) {
    result = result.slice(0, start) + result.slice(end);
  }
  return result;
}
