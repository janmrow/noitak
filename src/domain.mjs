// A null size denotes a domain deliberately left to symbolic reasoning.
export const productSize = (a, b) => a === null || b === null ? null : a * b;
export const sizeLabel = size => size === null ? 'symbolic-text' : String(size);
export const exceeds = (size, limit) => size === null || size > BigInt(limit);

export function cardinality(type) {
  if (type === 'text') return null;
  if (type === 'uuid') return 1n << 128n;
  if (type === 'i32' || type === 'u32') return 1n << 32n;
  if (type === 'byte') return 256n;
  if (type === 'bool') return 2n;
  if (type.element) {
    const size = cardinality(type.element);
    if (size === null) return null;
    if (size === 1n) return BigInt(type.capacity + 1);
    return (size ** BigInt(type.capacity + 1) - 1n) / (size - 1n);
  }
  if (type.fields) return type.fields.reduce((n, [, t]) => productSize(n, cardinality(t)), 1n);
  let total = 0n;
  for (const v of type.variants) {
    const size = v.payload ? cardinality(v.payload) : 1n;
    if (size === null) return null;
    total += size;
  }
  return total;
}

export function valueAt(type, index) {
  let digit = BigInt(index);
  if (type === 'uuid') {
    const hex = digit.toString(16).padStart(32, '0');
    return [hex.slice(0,8), hex.slice(8,12), hex.slice(12,16), hex.slice(16,20), hex.slice(20)].join('-');
  }
  if (type === 'i32') return Number(digit) - 2147483648;
  if (type === 'byte' || type === 'u32') return Number(digit);
  if (type === 'bool') return Boolean(digit);
  if (type.element) {
    const size = cardinality(type.element);
    let count = 1n;
    for (let length = 0; length <= type.capacity; length++) {
      if (digit < count) return Array.from({length}, () => {
        const value = valueAt(type.element, digit % size);
        digit /= size;
        return value;
      });
      digit -= count;
      count *= size;
    }
    throw new RangeError('Invalid sequence index');
  }
  if (type.fields) return Object.fromEntries(type.fields.map(([key, t]) => {
    const size = cardinality(t);
    const value = valueAt(t, digit % size);
    digit /= size;
    return [key, value];
  }));
  for (const {tag, payload} of type.variants) {
    const size = payload ? cardinality(payload) : 1n;
    if (digit < size) return payload ? { tag, value: valueAt(payload, digit) } : { tag };
    digit -= size;
  }
  throw new RangeError('Invalid domain index');
}

// The first parameter varies fastest, followed by subsequent parameters and grants.
export function domainOf(f) {
  const types = [...f.params.map(([, t]) => t), ...f.reads.map(() => 'bool')];
  const sizes = types.map(cardinality);
  const total = sizes.reduce(productSize, 1n);
  function at(index) {
    if (total === null) throw new Error('Text domains require symbolic reasoning');
    if (index < 0n || index >= total) throw new RangeError('Invalid assignment index');
    const values = sizes.map((size, j) => {
      const value = valueAt(types[j], index % size);
      index /= size;
      return value;
    });
    const args = values.slice(0, f.params.length);
    const flags = new Map(f.reads.map((key, j) => [key, values[f.params.length + j]]));
    return {args, flags};
  }
  function* cases() {
    if (total === null) throw new Error('Text domains require symbolic reasoning');
    for (let i = 0n; i < total; i++) yield at(i);
  }
  return { total, cases, at };
}

// Deterministic typed probes for domains without mixed-radix positions.
// Seed zero also supplies the canonical value for independence replay.
export function sampleValue(type, seed) {
  if (type === 'text') {
    const samples = ['', 'x', 'a/b', '\u0000', '\ud800', '😀', 'x'.repeat(1024)];
    return samples[seed % samples.length];
  }
  if (typeof type === 'string') {
    const size = cardinality(type);
    return valueAt(type, [0n, 1n, size - 1n, size / 2n][seed % 4]);
  }
  if (type.fields) return Object.fromEntries(type.fields.map(([key, field], i) =>
    [key, sampleValue(field, seed && seed + i)]));
  if (type.element) {
    const length = seed % 7 === 2 ? type.capacity : seed % (type.capacity + 1);
    return Array.from({length}, (_, i) => sampleValue(type.element, seed + i));
  }
  const {tag, payload} = type.variants[seed % type.variants.length];
  return payload ? {tag, value:sampleValue(payload, seed)} : {tag};
}
