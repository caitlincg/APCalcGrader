/**
 * Models often emit LaTeX inside "( ... )" without $...$, so remark-math skips it.
 * Wrap balanced parentheses that contain LaTeX (e.g. \frac, \approx) in $...$ for KaTeX.
 */

/** Match common LaTeX commands that appear inside prose parentheses */
const LATEX_CMD_IN_PARENS =
  /\\(?:frac|approx|implies|int|sum|sqrt|leq|geq|neq|cdot|times|div|arctan|tan|sin|cos|ln|log|pi|to|infty|partial|left|right|mid)/;

function findMatchingCloseParen(s: string, openIdx: number): number {
  let depth = 0;
  for (let j = openIdx; j < s.length; j++) {
    const c = s[j]!;
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}

/** Any `( ... )` whose inner text contains LaTeX → `$...$` */
function wrapParenthesizedMathSegments(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "(") {
      const j = findMatchingCloseParen(text, i);
      if (j !== -1) {
        const inner = text.slice(i + 1, j).trim();
        const startsWithCommand = /^\s*\\/.test(inner);
        const hasLatexCommand = LATEX_CMD_IN_PARENS.test(inner);
        if ((startsWithCommand || hasLatexCommand) && !inner.startsWith("$")) {
          out += `$${inner}$`;
          i = j + 1;
          continue;
        }
      }
    }
    out += text[i]!;
    i++;
  }
  return out;
}

/** `( t = 2.154 )` style (no `\approx`) → `$t = 2.154$` */
function wrapSimpleVariableEquals(text: string): string {
  return text.replace(/\(\s*([a-zA-Z])\s*=\s*([-\d.]+)\s*\)/g, (_, v: string, num: string) => `$${v} = ${num}$`);
}

/** `\(` `\)` delimiters (some model outputs) → `$` */
function normalizeLatexDelimiters(text: string): string {
  return text.replace(/\\\(/g, "$").replace(/\\\)/g, "$");
}

export function preprocessModelMathForKatex(text: string): string {
  let s = normalizeLatexDelimiters(text);
  s = wrapSimpleVariableEquals(s);
  s = wrapParenthesizedMathSegments(s);
  return s;
}
