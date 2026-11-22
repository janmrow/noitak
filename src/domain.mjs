// The first parameter varies fastest, followed by subsequent parameters and grants.
export function domainOf(f) {
  const types = [...f.params.map(([, t]) => t), ...f.reads.map(() => 'bool')];
  const sizes = types.map(t => t === 'byte' ? 256 : 2);
  const total = sizes.reduce((n, s) => n * BigInt(s), 1n);
  function* cases() {
    for (let i = 0; BigInt(i) < total; i++) {
      let index = i;
      const values = sizes.map((s, j) => {
        const digit = index % s;
        index = Math.floor(index / s);
        return types[j] === 'bool' ? Boolean(digit) : digit;
      });
      const args = values.slice(0, f.params.length);
      const flags = new Map(f.reads.map((key, j) => [key, values[f.params.length + j]]));
      yield { args, flags };
    }
  }
  return { total, cases };
}
