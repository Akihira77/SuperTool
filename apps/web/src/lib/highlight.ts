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
