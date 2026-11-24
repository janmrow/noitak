// The same API is callable from untyped JavaScript. Read data descriptors once.
export type Sample = Readonly<{celsius: number; calibrated: boolean}>;
export type Assessment = {excursions: number[]; quarantine: boolean};
type Result = {ok: true; value: Assessment} | {ok: false; code: 'ARGUMENT' | 'CAPABILITY'; phase: 'boundary'};
const invalid = (): Result => ({ok: false, code: 'ARGUMENT', phase: 'boundary'});
function own(object: unknown, key: PropertyKey): unknown {
  return typeof object === 'object' && object !== null
    ? Object.getOwnPropertyDescriptor(object, key)?.value : undefined;
}
export function assess(_flags: object, rows: readonly Sample[], privateNote: boolean): Result {
  try {
    if (arguments.length !== 3 || typeof privateNote !== 'boolean' || !Array.isArray(rows)) return invalid();
    const count = own(rows, 'length');
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > 3) return invalid();
    const excursions: number[] = [];
    for (let index = 0; index < count; index++) {
      const row = own(rows, index);
      const celsius = own(row, 'celsius');
      const calibrated = own(row, 'calibrated');
      if (typeof celsius !== 'number' || !Number.isInteger(celsius) ||
          celsius < -2147483648 || celsius > 2147483647 || typeof calibrated !== 'boolean') return invalid();
      if (calibrated && (celsius < 2 || celsius > 8)) excursions.push(celsius || 0);
    }
    if (_flags === null || typeof _flags !== 'object') return {ok:false, code:'CAPABILITY', phase:'boundary'};
    return {ok: true, value: {excursions, quarantine: excursions.length >= 2}};
  } catch { return invalid(); }
}
