export function cardinality(type) {
  if (type === 'uuid') return 1n << 128n;
  if (type === 'u32') return 1n << 32n;
  if (type === 'byte') return 256n;
  if (type === 'bool') return 2n;
  if (type.element) {
    const size = cardinality(type.element);
    let total = 1n;
    for (let length = 1; length <= type.capacity; length++) total = 1n + size * total;
    return total;
  }
  if (type.fields) return type.fields.reduce((n, [, t]) => n * cardinality(t), 1n);
  return type.variants.reduce((sum, v) => sum + (v.payload ? cardinality(v.payload) : 1n), 0n);
}

export function valueAt(type, index) {
  let digit = BigInt(index);
  if (type === 'uuid') {
    const hex = digit.toString(16).padStart(32, '0');
    return [hex.slice(0,8), hex.slice(8,12), hex.slice(12,16), hex.slice(16,20), hex.slice(20)].join('-');
  }
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
  const total = sizes.reduce((n, size) => n * size, 1n);
  function* cases() {
    for (let i = 0n; i < total; i++) {
      let index = i;
      const values = sizes.map((size, j) => {
        const value = valueAt(types[j], index % size);
        index /= size;
        return value;
      });
      const args = values.slice(0, f.params.length);
      const flags = new Map(f.reads.map((key, j) => [key, values[f.params.length + j]]));
      yield { args, flags };
    }
  }
  return { total, cases };
}
