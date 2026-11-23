import {api, type Record_request} from './verified/module.mjs';

// The caller supplies a policy snapshot from its trusted identity/grant store.
export function mayRead(request:Record_request, trace:string, systemTopics:boolean): boolean {
  const reply = api.authorize({system_topics:systemTopics},request,trace);
  return reply.ok && reply.value.tag === 'allow';
}
