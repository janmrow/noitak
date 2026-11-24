// Shared value semantics and host boundary for the interpreter and emitted ESM.
export function equalValue(left, right) {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object') return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every(k => Object.hasOwn(right, k) && equalValue(left[k], right[k]));
}

export class RangeFault extends Error {}
export class CallFault extends Error {
  constructor(code) { super(code); this.code = code; }
}
export const error = (code, phase) => ({ ok: false, code, phase });

export function argument(type, value, readers) {
  if (type === 'text') return typeof value === 'string' && value.length <= 1024 ? value : undefined;
  if (type === 'bool') return typeof value === 'boolean' ? value : undefined;
  if (type === 'uuid') return typeof value === 'string' && value.length === 36 &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value) ? value : undefined;
  if (type === 'i32') return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 ? value + 0 : undefined;
  if (type === 'u32') return Number.isInteger(value) && value >= 0 && value <= 0xffffffff ? value + 0 : undefined;
  if (type === 'byte') return Number.isInteger(value) && value >= 0 && value <= 255 ? value + 0 : undefined;
  if (value === null || typeof value !== 'object') return undefined;
  if (type.element) {
    if (!Array.isArray(value)) return undefined;
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
    if (!Number.isInteger(length) || length < 0 || length > type.capacity) return undefined;
    const copy = [];
    for (let i = 0; i < length; i++) {
      const item = argument(type.element, Object.getOwnPropertyDescriptor(value, i)?.value, readers);
      if (item === undefined) return undefined;
      copy.push(item);
    }
    return copy;
  }
  if (type.fields) {
    const reader = readers?.get(type.name);
    if (reader) return reader(value);
    const copy = {};
    for (const [key, fieldType] of type.fields) {
      const field = argument(fieldType, Object.getOwnPropertyDescriptor(value, key)?.value, readers);
      if (field === undefined) return undefined;
      Object.defineProperty(copy, key, { value: field, enumerable: true, writable: true, configurable: true });
    }
    return copy;
  }
  const tag = Object.getOwnPropertyDescriptor(value, 'tag')?.value;
  const variant = type.variants.find(v => v.tag === tag);
  if (!variant) return undefined;
  if (!variant.payload) return { tag };
  const payload = argument(variant.payload, Object.getOwnPropertyDescriptor(value, 'value')?.value, readers);
  return payload === undefined ? undefined : { tag, value: payload };
}

export function atBoundary(f, flags, args, run, readers) {
  if (args.length !== f.params.length) return error('ARGUMENT', 'boundary');
  let values;
  try {
    values = args.map((v, i) => {
      const type = f.params[i][1];
      if (f.capacity && i === 1) return argument({element: type, capacity: f.capacity}, v, readers);
      return argument(type, v, readers);
    });
  } catch { return error('ARGUMENT', 'boundary'); }
  if (values.includes(undefined)) return error('ARGUMENT', 'boundary');
  const snapshot = new Map();
  if (!flags || typeof flags !== 'object') return error('CAPABILITY', 'boundary');
  try {
    for (const key of f.reads) {
      const descriptor = Object.getOwnPropertyDescriptor(flags, key);
      if (typeof descriptor?.value !== 'boolean') return error('CAPABILITY', 'boundary');
      snapshot.set(key, descriptor.value);
    }
  } catch {
    return error('CAPABILITY', 'boundary');
  }
  const outcome = run(f, values, snapshot);
  // Materialize a fresh value tree so JS reference aliases cannot expose which
  // source expression produced equal structured results.
  if (outcome.ok) outcome.value = argument(f.output, outcome.value, readers);
  return outcome;
}
