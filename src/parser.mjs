export class Diagnostic extends Error {
  constructor(code, loc, message) {
    super(message);
    this.detail = { code, ...loc, message };
  }
}

export function fail(node, code, message) {
  throw new Diagnostic(code, node.loc, message);
}

// Each list retains the opening delimiter's location.
export function parse(source) {
  let line = 1, column = 1;
  const root = { items: [], loc: { line, column } };
  const stack = [root];
  for (const [token] of source.matchAll(/;[^\r\n]*|\s+|[()]|"(?:\\[^\r\n]|[^"\\\r\n])*"?|[^\s();"]+|./gu)) {
    const node = { loc: { line, column } };
    const lines = token.split(/\r\n|[\r\n]/u);
    line += lines.length - 1;
    column = lines.length === 1 ? column + token.length : lines.at(-1).length + 1;
    if (/^[;\s]/u.test(token)) continue;
    if (token === ')') {
      if (stack.length === 1) fail(node, 'E_PARSE', 'Unexpected closing delimiter');
      stack.pop();
      continue;
    }
    stack.at(-1).items.push(node);
    if (token === '(') {
      if (stack.length > 128) fail(node, 'E_LIMIT', 'Maximum list depth is 128');
      node.items = [];
      stack.push(node);
    } else if (token.startsWith('"')) {
      try { node.text = JSON.parse(token); }
      catch { fail(node, 'E_PARSE', 'Invalid JSON string literal'); }
    } else node.atom = token;
  }
  if (stack.length !== 1) fail(stack.at(-1), 'E_PARSE', 'Unclosed list');
  if (root.items.length !== 1) fail(root, 'E_PARSE', 'Expected exactly one module');
  return root.items[0];
}
