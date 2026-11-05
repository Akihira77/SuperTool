export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const TOKEN =
  /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

export function highlightJson(text: string): string {
  return escapeHtml(text).replace(TOKEN, (match) => {
    let cls = 'text-[#d7ba7d]';
    if (match.startsWith('"')) cls = match.trimEnd().endsWith(':') ? 'text-[#9cdcfe]' : 'text-[#98d982]';
    else if (/^(true|false)$/.test(match)) cls = 'text-[#c586c0]';
    else if (match === 'null') cls = 'text-muted';
    return '<span class="' + cls + '">' + match + '</span>';
  });
}

const CODE_EXT = new Set([
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'css', 'scss', 'less', 'html', 'htm', 'xml', 'svg',
  'py', 'sh', 'bash', 'zsh', 'yml', 'yaml', 'toml', 'ini', 'conf', 'php', 'rb', 'go', 'rs',
  'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cs', 'sql',
]);

const HASH_EXT = new Set(['py', 'sh', 'bash', 'zsh', 'yml', 'yaml', 'toml', 'ini', 'conf', 'rb']);

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'class',
  'extends', 'implements', 'import', 'from', 'export', 'default', 'new', 'await', 'async',
  'try', 'catch', 'finally', 'throw', 'switch', 'case', 'break', 'continue', 'type', 'interface',
  'enum', 'public', 'private', 'protected', 'readonly', 'static', 'abstract', 'declare', 'as',
  'in', 'of', 'this', 'super', 'typeof', 'instanceof', 'void', 'yield', 'delete', 'true', 'false',
  'null', 'undefined', 'def', 'elif', 'except', 'lambda', 'pass', 'raise', 'with', 'None', 'True',
  'False', 'import', 'package', 'func', 'struct', 'impl', 'let', 'mut', 'match', 'use', 'pub',
  'fn', 'SELECT', 'from', 'where', 'insert', 'update', 'delete',
]);

const TOKEN_SLASH = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;
const TOKEN_HASH = /(#[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;

/** Sorot satu baris berdasarkan ekstensi. JSON memakai highlighter lama; bahasa lain pola ringan. */
export function highlightLine(text: string, ext = ''): string {
  const lower = ext.toLowerCase();
  if (lower === 'json' || lower === 'jsonc') return highlightJson(text);
  if (!CODE_EXT.has(lower) || text.length > 2000) return escapeHtml(text);
  const hash = HASH_EXT.has(lower);
  const token = hash ? TOKEN_HASH : TOKEN_SLASH;
  let out = '';
  let last = 0;
  for (const match of text.matchAll(token)) {
    const value = match[0];
    const index = match.index ?? 0;
    let cls = '';
    if (value.startsWith('//') || value.startsWith('/*') || (hash && value.startsWith('#'))) cls = 'text-muted';
    else if (/^["'`]/.test(value)) cls = 'text-[#98d982]';
    else if (/^\d/.test(value)) cls = 'text-[#b5cea8]';
    else if (KEYWORDS.has(value.toLowerCase())) cls = 'text-[#c586c0]';
    out += escapeHtml(text.slice(last, index));
    out += cls ? '<span class="' + cls + '">' + escapeHtml(value) + '</span>' : escapeHtml(value);
    last = index + value.length;
  }
  out += escapeHtml(text.slice(last));
  return out;
}
