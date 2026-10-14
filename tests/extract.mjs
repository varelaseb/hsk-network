// The source of one top-level function in a site file: from its `function name(` line to the
// first line that is a lone `}` (top-level functions close at column 0). Throws if either is
// missing; no brace counting, so braces in strings cannot mislead it.
export function extract(src, name) {
  const start = src.search(new RegExp("^function " + name + "\\(", "m"));
  if (start < 0) throw new Error(`no top-level function ${name}`);
  const close = /^}$/m.exec(src.slice(start));
  if (!close) throw new Error(`function ${name} never closes at column 0`);
  return src.slice(start, start + close.index + 1);
}
