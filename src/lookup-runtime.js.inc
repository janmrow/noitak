// A grant carries identity only. The handler and key set stay in this realm.
const grants = new WeakMap();
export function grantLookup(resource, keys, read) {
  if (typeof resource !== 'string' || typeof read !== 'function' || !Array.isArray(keys))
    throw new TypeError('Expected a resource, bounded key list and read function');
  const length = Object.getOwnPropertyDescriptor(keys, 'length')?.value;
  if (!Number.isInteger(length) || length < 0 || length > 4096) throw new TypeError('Invalid lookup scope length');
  const scope = new Set();
  for (let i = 0; i < length; i++) {
    const key = Object.getOwnPropertyDescriptor(keys, i)?.value;
    if (argument('text', key) === undefined) throw new TypeError('Invalid lookup key');
    scope.add(key);
  }
  const token = Object.freeze(Object.create(null));
  grants.set(token, {resource, scope, read});
  return token;
}

function performLookup(spec, planner, resume, token, flags, args) {
  const grant = grants.get(token);
  if (!grant || grant.resource !== spec.resource) return error('CAPABILITY', 'boundary');
  return atBoundary(spec, flags, args, (_spec, values, snapshot) => {
    const key = runCompiled(planner, values, snapshot);
    if (!key.ok) return key;
    if (!grant.scope.has(key.value)) return error('CAPABILITY', 'boundary');
    let raw;
    try {
      const read = grant.read;
      raw = read(key.value);
    } catch {
      raw = {tag:'unavailable'};
    }
    let reply;
    try {
      reply = argument(spec.reply, raw, readers);
    } catch {}
    if (reply === undefined) return error('RESOURCE_RESPONSE', 'boundary');
    return runCompiled(resume, [...values, reply], snapshot);
  }, readers);
}
