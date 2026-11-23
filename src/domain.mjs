export function cardinality(type) {
  if (type === 'byte') return 256n;
  if (type === 'bool') return 2n;
  if (type.fields) return type.fields.reduce((n, [, t]) => n * cardinality(t), 1n);
  return type.variants.reduce((sum, v) => sum + (v.payload ? cardinality(v.payload) : 1n), 0n);
}

export function valueAt(type, index) {
  let digit = BigInt(index);
  if (type === 'byte') return Number(digit);
  if (type === 'bool') return Boolean(digit);
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
