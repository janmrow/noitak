// Independent model for canonical, already admitted application values.
// The artifact additionally validates its host boundary and evaluates contracts.
type Status = 'ready' | 'foreign_meter' | 'out_of_order' | 'quota_exceeded';
type Account = {
  meter: string; used: number; limit: number; serial: number; status: {tag: Status}
};
type Reading = {meter: string; serial: number; units: number};

export function reconcile(account: Account, rows: ReadonlyArray<Reading>): Account {
  const result = {...account};
  for (const row of rows) {
    if (result.status.tag !== 'ready') break;
    const total = BigInt(result.used) + BigInt(row.units);
    if (row.meter !== result.meter) result.status = {tag:'foreign_meter'};
    else if (BigInt(row.serial) !== BigInt(result.serial) + 1n) result.status = {tag:'out_of_order'};
    else if (total > BigInt(result.limit)) result.status = {tag:'quota_exceeded'};
    else {
      result.used = Number(total);
      result.serial = row.serial;
    }
  }
  return result;
}
