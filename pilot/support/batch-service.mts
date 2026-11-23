import { api, type Seq_events, type Record_support$ticket, type Record_support$staff } from './approved/module.mjs';

type Row = { ticket: Record_support$ticket; staff: Record_support$staff };
type Reply = { status: 'updated'; revision: number } | { status: 'rejected'; index: number }
  | { status: 'missing' | 'invalid' };

class Inbox {
  constructor(private readonly rows: Map<string, Row>) {}

  submit(id: string, events: Seq_events): Reply {
    const row = this.rows.get(id);
    if (!row) return { status: 'missing' };
    const decision = api.apply_batch({}, row.ticket, events, row.staff);
    if (!decision.ok) {
      if (decision.code === 'ARGUMENT') return { status: 'invalid' };
      throw Error(decision.code);
    }
    if (decision.value.tag === 'rejected') return { status: 'rejected', index: decision.value.value };
    row.ticket = decision.value.value;
    return { status: 'updated', revision: row.ticket.revision };
  }
}

const row: Row = { ticket:{stage:{tag:'waiting'},revision:253}, staff:{covered:true,escalated:false} };
const inbox = new Inbox(new Map([['T42', row]]));
const denied = inbox.submit('T42', [{tag:'customer_reply'}, {tag:'agent_reply'}, {tag:'resolve'}]);
const afterRejection = row.ticket;
const accepted = inbox.submit('T42', [{tag:'customer_reply'}, {tag:'staff_note'}, {tag:'resolve'}]);
const tooLong = inbox.submit('T42', Array(4).fill({tag:'staff_note'}));
console.log(JSON.stringify({denied, afterRejection, accepted, tooLong, final:row.ticket}));
