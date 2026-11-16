/**
 * EasyJS Source Auto-Formatter
 * Normalizes indentation (2 spaces per nesting level), trims trailing whitespace,
 * collapses excessive blank lines, and preserves comments & string literals.
 */
export function formatEasyJS(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let braceIndent = 0;
  let colonIndentStack: number[] = [];
  let prevBlank = false;

  let styleBraceDepth = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx];
    const trimmed = rawLine.trim();

    if (trimmed === '') {
      if (!prevBlank && out.length > 0) {
        out.push('');
        prevBlank = true;
      }
      continue;
    }
    prevBlank = false;

    if (styleBraceDepth > 0) {
      const startsWithCloseBrace = trimmed.startsWith('}');
      if (startsWithCloseBrace) {
        braceIndent = Math.max(0, braceIndent - 1);
      }
      const totalIndent = braceIndent + colonIndentStack.length;
      out.push('  '.repeat(totalIndent) + trimmed);
      const opens = (trimmed.match(/\{/g) || []).length;
      const closes = (trimmed.match(/\}/g) || []).length;
      if (startsWithCloseBrace) {
        braceIndent = Math.max(0, braceIndent + opens - Math.max(0, closes - 1));
      } else {
        braceIndent = Math.max(0, braceIndent + opens - closes);
      }
      styleBraceDepth = Math.max(0, styleBraceDepth + opens - closes);
      continue;
    }

    // Count leading spaces of original line to track dedent out of colon-indented blocks
    const rawLeading = rawLine.match(/^(\s*)/)?.[1].replace(/\t/g, '  ').length ?? 0;
    while (
      colonIndentStack.length > 0 &&
      rawLeading <= colonIndentStack[colonIndentStack.length - 1]
    ) {
      colonIndentStack.pop();
    }

    // Decrease brace indent if line starts with closing brace
    const startsWithCloseBrace = trimmed.startsWith('}');
    if (startsWithCloseBrace) {
      braceIndent = Math.max(0, braceIndent - 1);
    }

    const totalIndent = braceIndent + colonIndentStack.length;
    const formattedLine = '  '.repeat(totalIndent) + normalizeSpacing(trimmed);
    out.push(formattedLine);

    // Strip strings and line comments when checking block openers/closers
    const codePart = stripStringsAndComments(trimmed);

    // Track `{` / `}` net change
    const opens = (codePart.match(/\{/g) || []).length;
    const closes = (codePart.match(/\}/g) || []).length;
    if (/^style\s*\{/.test(codePart) && opens > closes) {
      styleBraceDepth = opens - closes;
    }
    if (startsWithCloseBrace) {
      braceIndent = Math.max(0, braceIndent + opens - Math.max(0, closes - 1));
    } else {
      braceIndent = Math.max(0, braceIndent + opens - closes);
    }

    // Track colon-ended block headers (`if cond:`, `else:`, `repeat 5 times:`, `function foo():`, etc.)
    if (codePart.endsWith(':') && !codePart.includes('?')) {
      colonIndentStack.push(rawLeading);
    }
  }

  while (out.length > 0 && out[out.length - 1] === '') {
    out.pop();
  }
  return out.join('\n') + '\n';
}

function stripStringsAndComments(line: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '#') break;
    if (ch === '/' && line[i + 1] === '/') break;
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    out += ch;
  }
  return out;
}

function normalizeSpacing(line: string): string {
  // Collapse multiple internal spaces outside string literals gently
  let out = '';
  let quote: string | null = null;
  let lastWasSpace = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < line.length) {
        out += line[++i];
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '#' || (ch === '/' && line[i + 1] === '/')) {
      out += line.slice(i);
      break;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      lastWasSpace = false;
      out += ch;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (!lastWasSpace) {
        out += ' ';
        lastWasSpace = true;
      }
      continue;
    }
    lastWasSpace = false;
    out += ch;
  }
  return out.trimEnd();
}
