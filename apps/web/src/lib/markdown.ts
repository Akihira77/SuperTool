import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false }) as string;
  // Checkbox task-list hanya penanda visual di dalam <li> (disabled, tidak
  // fokusable); teks item sudah membawa maknanya.
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] }).replace(
    /<input([^>]*type="checkbox"[^>]*)>/g,
    '<input$1 aria-hidden="true" tabindex="-1">',
  );
}
