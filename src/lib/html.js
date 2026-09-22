// Minimal, safe templating.
// html`` escapes every interpolated value unless it is itself the result of html`` or raw().
// Arrays are flattened, and null / undefined / false render as nothing.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

class SafeHtml {
  constructor(text) {
    this.text = text;
  }
  toString() {
    return this.text;
  }
}

/** Mark a string as trusted HTML. Only use with markup you generated yourself. */
export const raw = (text) => new SafeHtml(text ?? '');

function renderValue(value) {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof SafeHtml) return value.text;
  if (Array.isArray(value)) return value.map(renderValue).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i += 1) out += renderValue(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** Render a list of items with a separator between them. */
export function join(items, separator = '') {
  return raw(items.map(renderValue).join(renderValue(separator)));
}

/** Build an attribute string from an object; false / null values are skipped, true renders a bare attribute. */
export function attrs(object) {
  return raw(
    Object.entries(object)
      .filter(([, v]) => v !== false && v !== null && v !== undefined)
      .map(([k, v]) => (v === true ? k : `${k}="${escapeHtml(v)}"`))
      .join(' '),
  );
}

/** Replace an element's content with a template result. */
export function mount(element, template) {
  element.innerHTML = renderValue(template);
}
