import { api, type Record_account, type Record_reading } from './verified/module.mjs';

type Submission =
  | { status: 'missing' | 'invalid-input' | 'invalid-account' }
  | { status: 'rejected'; reason: 'foreign_meter' | 'out_of_order' | 'quota_exceeded' }
  | { status: 'committed'; serial: number; used: number };

// A synchronous in-memory transaction. Persistent stores need their own
// compare-and-swap or transaction around the read and replacement.
export class MeterStore {
  constructor(private readonly accounts: Map<string, Record_account>) {}

  submit(meter: string, readings: ReadonlyArray<Record_reading>): Submission {
    const account = this.accounts.get(meter);
    if (!account) return { status: 'missing' };
    if (account.meter !== meter) return { status: 'invalid-account' };
    const reply = api.reconcile({}, account, readings);
    if (!reply.ok) {
      if (reply.code === 'ARGUMENT') return { status: 'invalid-input' };
      if (reply.code === 'PRECONDITION') return { status: 'invalid-account' };
      throw Error(reply.code);
    }
    const next = reply.value;
    if (next.status.tag !== 'ready') return { status: 'rejected', reason: next.status.tag };
    this.accounts.set(meter, next);
    return { status: 'committed', serial: next.serial, used: next.used };
  }
}
