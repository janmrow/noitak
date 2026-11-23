// The service receives untrusted JS at runtime, including callers without TypeScript.
export type Scope = {readonly tag:'none'} | {readonly tag:'exact' | 'subtree', readonly value:string};
export interface TopicRequest {
  readonly actor: {readonly tenant:string, readonly disabled:boolean, readonly grant:Scope};
  readonly topic: {readonly tenant:string, readonly key:string};
}
type Decision = 'allow' | 'unavailable' | 'protected' | 'outside_scope';
type Reply = {ok:true, value:{tag:Decision}} | {ok:false, code:'ARGUMENT' | 'CAPABILITY', phase:'boundary'};

function field(object:unknown, key:string):unknown {
  if (typeof object !== 'object' || object === null) return undefined;
  return Object.getOwnPropertyDescriptor(object,key)?.value;
}
function text(value:unknown): value is string {
  return typeof value === 'string' && value.length <= 1024;
}
function uuid(value:unknown): value is string {
  return typeof value === 'string' && value.length === 36 &&
    /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(value);
}
function scope(input:unknown): Scope | undefined {
  const tag = field(input,'tag');
  if (tag === 'none') return {tag};
  if (tag !== 'exact' && tag !== 'subtree') return undefined;
  const value = field(input,'value');
  return text(value) ? {tag,value} : undefined;
}
function snapshot(input:unknown): TopicRequest | undefined {
  const actor = field(input,'actor');
  const tenant = field(actor,'tenant'), disabled = field(actor,'disabled'), grant = scope(field(actor,'grant'));
  if (!uuid(tenant) || typeof disabled !== 'boolean' || !grant) return undefined;
  const topic = field(input,'topic');
  const owner = field(topic,'tenant'), key = field(topic,'key');
  if (!uuid(owner) || !text(key)) return undefined;
  return {actor:{tenant,disabled,grant}, topic:{tenant:owner,key}};
}
function decide({actor,topic}:TopicRequest, systemTopics:boolean): Decision {
  if (actor.disabled || actor.tenant !== topic.tenant || topic.key.length === 0) return 'unavailable';
  if (topic.key.indexOf('system/') === 0 && !systemTopics) return 'protected';
  const grant = actor.grant;
  if (grant.tag === 'none') return 'outside_scope';
  if (grant.tag === 'exact') return grant.value === topic.key ? 'allow' : 'outside_scope';
  const descendant = grant.value.endsWith('/') && topic.key.length > grant.value.length &&
    topic.key.slice(0,grant.value.length) === grant.value;
  return descendant ? 'allow' : 'outside_scope';
}
export function authorize(flags:{readonly system_topics:boolean}, input:TopicRequest, trace:string):Reply {
  const invalid = {ok:false,code:'ARGUMENT',phase:'boundary'} as const;
  let request;
  try {
    if (arguments.length !== 3) return invalid;
    request = snapshot(input);
    if (!request || !text(trace)) return invalid;
  } catch { return invalid; }
  let systemTopics;
  try { systemTopics = field(flags,'system_topics'); }
  catch { systemTopics = undefined; }
  if (typeof systemTopics !== 'boolean') return {ok:false,code:'CAPABILITY',phase:'boundary'};
  return {ok:true,value:{tag:decide(request,systemTopics)}};
}
