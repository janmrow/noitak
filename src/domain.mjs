export function cardinality(type) {
  if (type === 'byte') return 256;
  if (type === 'bool') return 2;
  return type.variants.reduce((sum, v) => sum + (v.payload ? cardinality(v.payload) : 1), 0);
}

export function valueAt(type, digit) {
  if (type === 'byte') return digit;
  if (type === 'bool') return Boolean(digit);
  for (const {tag, payload} of type.variants) {
    const size = payload ? cardinality(payload) : 1;
    if (digit < size) return payload ? { tag, value: valueAt(payload, digit) } : { tag };
    digit -= size;
  }
  throw new RangeError('Invalid domain index');
}

// The first parameter varies fastest, followed by subsequent parameters and grants.
export function domainOf(f) {
  const types = [...f.params.map(([, t]) => t), ...f.reads.map(() => 'bool')];
  const sizes = types.map(cardinality);
  const total = sizes.reduce((n, s) => n * BigInt(s), 1n);
  function* cases() {
    for (let i = 0; BigInt(i) < total; i++) {
      let index = i;
      const values = sizes.map((s, j) => {
        const digit = index % s;
        index = Math.floor(index / s);
        return valueAt(types[j], digit);
      });
      const args = values.slice(0, f.params.length);
      const flags = new Map(f.reads.map((key, j) => [key, values[f.params.length + j]]));
      yield { args, flags };
    }
  }
  return { total, cases };
}
