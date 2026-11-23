import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

export type TaskLabels = { done: string; open: string };

const DEFAULT_TASK_LABELS: TaskLabels = { done: 'Tugas selesai', open: 'Tugas belum selesai' };

/**
 * Checkbox task-list dari `marked` tidak punya accessible name (axe: `label`),
 * tapi menyembunyikannya membuat status checked hilang dari screen reader.
 * Jadi checkbox tetap ada di accessibility tree dengan label status yang
 * statis, sementara atribut `disabled` bawaan marked sudah mengeluarkannya dari
 * urutan Tab. Atribut dipasang lewat DOM setelah sanitasi, tidak dengan
 * menyambung string HTML.
 */
export function renderMarkdown(source: string, labels: TaskLabels = DEFAULT_TASK_LABELS): string {
  const html = marked.parse(source, { async: false }) as string;
  const safe = DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
  const template = document.createElement('template');
  template.innerHTML = safe;
  const boxes = template.content.querySelectorAll('input[type="checkbox"]');
  if (!boxes.length) return safe;
  for (const box of boxes) {
    box.setAttribute('tabindex', '-1');
    box.setAttribute('aria-label', box.hasAttribute('checked') ? labels.done : labels.open);
  }
  return template.innerHTML;
}
