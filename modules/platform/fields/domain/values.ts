// Owner-defined fields: what a definition may say, and how a value is checked and stored.
// Pure: no database, no framework. Numbers stay decimal strings so nothing becomes a float.

export const FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'date',
  'yes_no',
  'choice',
  'multi_choice',
  'phone',
  'email',
  'file',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_ENTITIES = [
  'organisation',
  'campus',
  'institution',
  'admission',
  'staff',
  'student',
  'guardian',
] as const;
export type FieldEntity = (typeof FIELD_ENTITIES)[number];

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  required: boolean;
};

export type FieldValue = string | boolean | string[] | null;
export type ValueError = 'required' | 'invalid' | 'too_long' | 'not_an_option';
export type Cleaned = { ok: true; value: FieldValue } | { ok: false; error: ValueError };

export const MAX_ACTIVE_FIELDS = 60;
const MAX_OPTIONS = 100;
const MAX_TEXT = 200;
const MAX_LONG_TEXT = 2000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMBER = /^-?\d{1,12}(\.\d{1,4})?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ok = (value: FieldValue): Cleaned => ({ ok: true, value });
const bad = (error: ValueError): Cleaned => ({ ok: false, error });

const isEmpty = (raw: unknown) =>
  raw === undefined ||
  raw === null ||
  (typeof raw === 'string' && raw.trim() === '') ||
  (Array.isArray(raw) && raw.length === 0);

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Checks one value against its field and returns what to store (null means none). */
export function cleanValue(def: FieldDef, raw: unknown): Cleaned {
  if (isEmpty(raw)) return def.required ? bad('required') : ok(null);
  switch (def.type) {
    case 'text':
    case 'long_text': {
      if (typeof raw !== 'string') return bad('invalid');
      const v = raw.trim();
      return v.length > (def.type === 'text' ? MAX_TEXT : MAX_LONG_TEXT) ? bad('too_long') : ok(v);
    }
    case 'number': {
      const v =
        typeof raw === 'number' && Number.isSafeInteger(raw)
          ? String(raw)
          : typeof raw === 'string'
            ? raw.trim()
            : null;
      return v !== null && NUMBER.test(v) ? ok(v) : bad('invalid');
    }
    case 'date':
      return typeof raw === 'string' && isRealDate(raw.trim()) ? ok(raw.trim()) : bad('invalid');
    case 'yes_no':
      return typeof raw === 'boolean' ? ok(raw) : bad('invalid');
    case 'choice':
      if (typeof raw !== 'string') return bad('invalid');
      return def.options.includes(raw) ? ok(raw) : bad('not_an_option');
    case 'multi_choice': {
      if (!Array.isArray(raw) || !raw.every((x) => typeof x === 'string')) return bad('invalid');
      if (!raw.every((x) => def.options.includes(x))) return bad('not_an_option');
      // Stored in the definition's order, once each.
      return ok(def.options.filter((o) => raw.includes(o)));
    }
    case 'phone': {
      if (typeof raw !== 'string') return bad('invalid');
      const digits = raw.replace(/[\s\-()]/g, '').replace(/^\+91/, '');
      return /^[6-9]\d{9}$/.test(digits) ? ok(`+91${digits}`) : bad('invalid');
    }
    case 'email': {
      if (typeof raw !== 'string') return bad('invalid');
      const v = raw.trim().toLowerCase();
      return v.length <= 200 && EMAIL.test(v) ? ok(v) : bad('invalid');
    }
    case 'file':
      return typeof raw === 'string' && UUID.test(raw) ? ok(raw.toLowerCase()) : bad('invalid');
  }
}

/** A stable key from the label: lower case, underscores, starting with a letter. */
export function keyFromLabel(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (!base) return 'field';
  return /^[a-z]/.test(base) ? base : `f_${base}`.slice(0, 41);
}

/** What is wrong with a definition, or null. */
export function checkDefinition(def: FieldDef): 'label' | 'options' | null {
  if (!def.label.trim() || def.label.length > 80) return 'label';
  const choices = def.type === 'choice' || def.type === 'multi_choice';
  if (!choices) return def.options.length === 0 ? null : 'options';
  const seen = new Set(def.options.map((o) => o.trim().toLowerCase()));
  const okList =
    def.options.length > 0 &&
    def.options.length <= MAX_OPTIONS &&
    def.options.every((o) => o.trim() !== '' && o.length <= 80) &&
    seen.size === def.options.length;
  return okList ? null : 'options';
}
