/**
 * Models often emit LaTeX inside "( \frac{...}{...} )" without $...$, so remark-math
 * skips it. Wrap those snippets (and a few common patterns) in $...$ for KaTeX.
 */

/** `( \command... )` with balanced parentheses → `$...$` */
function wrapParenthesizedLatexStartingWithBackslash(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "(") {
      let k = i + 1;
      while (k < text.length && /\s/.test(text[k]!)) k++;
      if (k < text.length && text[k] === "\\") {
        let depth = 0;
        let j = i;
        for (; j < text.length; j++) {
          const c = text[j]!;
          if (c === "(") depth++;
          else if (c === ")") {
            depth--;
            if (depth === 0) {
              const inner = text.slice(i + 1, j).trim();
              if (!inner.startsWith("$")) {
                out += `$${inner}$`;
              } else {
                out += text.slice(i, j + 1);
              }
              i = j + 1;
              break;
            }
          }
        }
        if (j >= text.length) {
          out += text[i]!;
          i++;
        }
      } else {
        out += text[i]!;
        i++;
      }
    } else {
      out += text[i]!;
      i++;
    }
  }
  return out;
}

/** `( t = 2.154 )` style → `$t = 2.154$` */
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
  s = wrapParenthesizedLatexStartingWithBackslash(s);
  return s;
}
