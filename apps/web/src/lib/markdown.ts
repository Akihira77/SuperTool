import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

export type TaskLabels = { done: string; open: string; code?: string };

const DEFAULT_TASK_LABELS: TaskLabels = {
  done: 'Tugas selesai',
  open: 'Tugas belum selesai',
  code: 'Blok kode',
};

export type MarkdownOptions = {
  /**
   * Turunkan level heading konten sebanyak ini. Halaman sudah punya `h1`
   * (judul tool), jadi heading dokumen dimulai dari `h2` agar outline screen
   * reader tidak punya dua `h1`. Isi Markdown pengguna tidak diubah.
   */
  headingOffset?: number;
};

/**
 * Checkbox task-list dari `marked` tidak punya accessible name (axe: `label`),
 * tapi menyembunyikannya membuat status checked hilang dari screen reader.
 * Jadi checkbox tetap ada di accessibility tree dengan label status yang
 * statis, sementara atribut `disabled` bawaan marked sudah mengeluarkannya dari
 * urutan Tab. Atribut dipasang lewat DOM setelah sanitasi, tidak dengan
 * menyambung string HTML.
 */
export function renderMarkdown(
  source: string,
  labels: TaskLabels = DEFAULT_TASK_LABELS,
  options: MarkdownOptions = {},
): string {
  const html = marked.parse(source, { async: false }) as string;
  const safe = DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
  const template = document.createElement('template');
  template.innerHTML = safe;
  const offset = Math.max(0, Math.min(5, options.headingOffset ?? 0));
  if (offset) {
    for (let level = 5; level >= 1; level -= 1) {
      for (const heading of template.content.querySelectorAll(`h${level}`)) {
        const next = document.createElement(`h${Math.min(6, level + offset)}`);
        for (const attribute of heading.attributes) next.setAttribute(attribute.name, attribute.value);
        next.innerHTML = heading.innerHTML;
        heading.replaceWith(next);
      }
    }
  }
  const boxes = template.content.querySelectorAll('input[type="checkbox"]');
  for (const box of boxes) {
    box.setAttribute('tabindex', '-1');
    box.setAttribute('aria-label', box.hasAttribute('checked') ? labels.done : labels.open);
  }
  // Blok kode panjang bisa di-scroll horizontal; beri fokus keyboard + nama.
  for (const pre of template.content.querySelectorAll('pre')) {
    pre.setAttribute('tabindex', '0');
    pre.setAttribute('role', 'region');
    if (labels.code) pre.setAttribute('aria-label', labels.code);
  }
  return template.innerHTML;
}
