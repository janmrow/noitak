// Independent webhook policy and host decoder. This model does not call a
// generated dispatcher or share Noitak's boundary implementation.
export type Delivery = {
  repository: {slug: string; archived: boolean};
  change: {tag: 'other'} | {
    tag: 'push';
    value: {ref: {tag: 'missing'} | {tag: 'present'; value: string}; deleted: boolean};
  };
  labels: string[];
};

export type Job = {repository: string; branch: string; urgent: boolean};
const malformed = {ok: false, code: 'ARGUMENT', phase: 'boundary'} as const;

function own(value: unknown, key: PropertyKey): unknown {
  return value !== null && typeof value === 'object'
    ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length > 1024) throw new TypeError();
  return value;
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError();
  return value;
}

function array<T>(value: unknown, bound: number, read: (item: unknown) => T): T[] {
  const length = own(value, 'length');
  if (!Array.isArray(value) || typeof length !== 'number' || !Number.isInteger(length) ||
      length < 0 || length > bound) throw new TypeError();
  const items: T[] = [];
  for (let i = 0; i < length; i++) items.push(read(own(value, i)));
  return items;
}

function delivery(value: unknown): Delivery {
  const repo = own(value, 'repository');
  const repository = {slug: text(own(repo, 'slug')), archived: bool(own(repo, 'archived'))};
  const labels = array(own(value, 'labels'), 128, text);
  const change = own(value, 'change');
  const kind = own(change, 'tag');
  if (kind === 'other') return {repository, labels, change: {tag: 'other'}};
  if (kind !== 'push') throw new TypeError();
  const push = own(change, 'value');
  const deleted = bool(own(push, 'deleted'));
  const ref = own(push, 'ref');
  const tag = own(ref, 'tag');
  if (tag !== 'missing' && tag !== 'present') throw new TypeError();
  return {repository, labels, change: {tag: 'push', value: {
    deleted, ref: tag === 'missing' ? {tag} : {tag, value: text(own(ref, 'value'))}
  }}};
}

export function queuedJobs(batch: unknown) {
  let rows: Delivery[];
  try { rows = array(batch, 32, delivery); }
  catch { return malformed; }
  const jobs: Job[] = [];
  for (const {repository, change, labels} of rows) {
    if (repository.archived || !repository.slug || change.tag === 'other') continue;
    const {deleted, ref} = change.value;
    if (deleted || ref.tag === 'missing') continue;
    const match = /^refs\/heads\/([\s\S]+)$/.exec(ref.value);
    if (match) jobs.push({repository: repository.slug, branch: match[1], urgent: labels.includes('ci:urgent')});
  }
  return {ok: true, value: jobs} as const;
}

export function lightweight(flags: unknown, batch: unknown, capacity: number) {
  let rows: {tag: 'emit_me' | 'skip_me'}[];
  try {
    rows = array(batch, capacity, row => {
      const tag = own(row, 'tag');
      if (tag !== 'emit_me' && tag !== 'skip_me') throw new TypeError();
      return {tag};
    });
  } catch { return malformed; }
  let include: unknown;
  try { include = own(flags, 'include'); } catch { /* Rejected below. */ }
  if (typeof include !== 'boolean') return {ok:false,code:'CAPABILITY',phase:'boundary'} as const;
  return {ok:true,value:include ? rows : rows.filter(row => row.tag === 'emit_me')} as const;
}
