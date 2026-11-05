const ALLOWED_TAGS = new Set([
  'a', 'b', 'strong', 'i', 'em', 'u', 's', 'br', 'p', 'div', 'span',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'hr', 'h1', 'h2', 'h3', 'h4',
]);

// Tag yang isinya tidak boleh ikut tampil, bukan sekadar dibuka wrapper-nya.
const DROPPED_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'img', 'svg', 'math',
  'form', 'input', 'button', 'textarea', 'select', 'option', 'link', 'meta', 'base',
  'video', 'audio', 'source', 'track',
]);

const SAFE_PROTOCOL = /^(https?:|mailto:|tel:)/i;

/** Hanya URL yang aman untuk href; URL relatif tidak dipakai di detail event. */
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const href = value.trim();
  return SAFE_PROTOCOL.test(href) ? href : null;
}

function cleanNode(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) return;
  if (node.nodeType !== Node.ELEMENT_NODE) {
    node.parentNode?.removeChild(node);
    return;
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (DROPPED_TAGS.has(tag)) {
    element.remove();
    return;
  }

  if (!ALLOWED_TAGS.has(tag)) {
    const children = Array.from(element.childNodes);
    element.replaceWith(...children);
    for (const child of children) cleanNode(child);
    return;
  }

  const href = tag === 'a' ? safeExternalUrl(element.getAttribute('href')) : null;
  for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name);
  if (href) {
    element.setAttribute('href', href);
    element.setAttribute('target', '_blank');
    element.setAttribute('rel', 'noopener noreferrer');
  }

  for (const child of Array.from(element.childNodes)) cleanNode(child);
}

/**
 * Deskripsi Google Calendar berupa HTML. Whitelist tag + URL agar aman
 * dirender dengan dangerouslySetInnerHTML; atribut selain href dibuang.
 */
export function sanitizeEventHtml(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const child of Array.from(doc.body.childNodes)) cleanNode(child);
  return doc.body.innerHTML;
}
