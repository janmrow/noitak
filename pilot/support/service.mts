import { api, type Enum_event, type Record_ticket, type Record_staff, type Record_summary } from './approved/module.mjs';

type Row = { id: string; ticket: Record_ticket; internal: Record_staff };
type Reply = { kind: 'missing' | 'revision-limit' } | { kind: 'updated'; summary: Record_summary };

// Storage and the internal dispatch list belong to the host. Its public response
// returns only the projection produced by the gated module.
class TicketService {
  readonly dispatch: string[] = [];
  constructor(private readonly rows: Map<string, Row>) {}

  apply(id: string, action: Enum_event): Reply {
    const row = this.rows.get(id);
    if (!row) return {kind: 'missing'};
    const next = api.transition({}, row.ticket, action);
    if (!next.ok) {
      if (next.code === 'PRECONDITION') return {kind: 'revision-limit'};
      throw Error(next.code);
    }
    const view = api.public_view({}, next.value, row.internal);
    const route = api.route({}, next.value, row.internal);
    if (!view.ok || !route.ok) throw Error('Invalid ticket data');
    row.ticket = next.value;
    if (route.value.tag === 'on_call') this.dispatch.push(id);
    return {kind: 'updated', summary: view.value};
  }
}

const row: Row = {id:'T42', ticket:{stage:{tag:'waiting'}, revision:253}, internal:{escalated:true, covered:true}};
const service = new TicketService(new Map([[row.id, row]]));
const replies = (['customer_reply','resolve','staff_note','agent_reply'] as const)
  .map(tag => service.apply(row.id, {tag}));
console.log(JSON.stringify({replies, dispatch:service.dispatch, ticket:row.ticket}));
