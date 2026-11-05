type Field = { type: string; count: number };
type Shape = { fields: Map<string, Field>; total: number };

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pascal(input: string): string {
  const words = input.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'Item';
  const out = words.map((word) => word[0].toUpperCase() + word.slice(1)).join('');
  return /^[0-9]/.test(out) ? 'N' + out : out;
}

function singular(word: string): string {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (/(?:ses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word + 'Item';
}

function prop(key: string): string {
  return IDENT.test(key) ? key : "'" + key.replace(/'/g, "\\'") + "'";
}

function union(a: string, b: string): string {
  if (a === b) return a;
  return [...new Set(a.split(' | ').concat(b.split(' | ')))].join(' | ');
}

export function jsonToTs(input: unknown, rootName = 'Root'): string {
  const shapes = new Map<string, Shape>();
  const root = pascal(rootName || 'Root');

  const shapeOf = (name: string): Shape => {
    const existing = shapes.get(name);
    if (existing) return existing;
    const created: Shape = { fields: new Map(), total: 0 };
    shapes.set(name, created);
    return created;
  };

  const typeOf = (value: unknown, hint: string): string => {
    if (Array.isArray(value)) {
      if (!value.length) return 'unknown[]';
      const elementHint = pascal(singular(hint));
      let inner = '';
      for (const item of value) {
        const next = typeOf(item, elementHint);
        inner = inner ? union(inner, next) : next;
      }
      return inner.includes(' | ') ? '(' + inner + ')[]' : inner + '[]';
    }
    if (isPlainObject(value)) {
      const shape = shapeOf(hint);
      shape.total += 1;
      for (const [key, val] of Object.entries(value)) {
        const type = typeOf(val, pascal(key));
        const field = shape.fields.get(key);
        if (field) {
          field.type = union(field.type, type);
          field.count += 1;
        } else {
          shape.fields.set(key, { type, count: 1 });
        }
      }
      return hint;
    }
    if (value === null) return 'null';
    return typeof value;
  };

  if (Array.isArray(input)) {
    return 'export type ' + root + ' = ' + typeOf(input, root) + ';\n';
  }
  if (!isPlainObject(input)) {
    return 'export type ' + root + ' = ' + typeOf(input, root) + ';\n';
  }
  typeOf(input, root);

  let out = '';
  for (const [name, shape] of shapes) {
    out += 'export interface ' + name + ' {\n';
    for (const [key, field] of shape.fields) {
      const optional = field.count < shape.total ? '?' : '';
      out += '  ' + prop(key) + optional + ': ' + field.type + ';\n';
    }
    out += '}\n\n';
  }
  return out.trimEnd() + '\n';
}
