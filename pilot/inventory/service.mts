import {grantLookup, services, type Record_balance, type Record_order_line} from './verified/module.mjs';

// The caller controls which SKUs this application tenant may read.
export function purchasingDesk(store: ReadonlyMap<string,Record_balance>, allowed: readonly string[]) {
  const grant = grantLookup('stockroom', allowed, sku => {
    const balance = store.get(sku);
    return balance === undefined ? {tag:'missing'} : {tag:'found',value:balance};
  });
  return (line: Record_order_line) => services.replenish(grant, {}, line);
}
