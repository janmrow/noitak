import { api, type Enum_receipt } from './artifact/module.mjs';

function acknowledge(status: Enum_receipt, sequence: number): Enum_receipt {
  const result = api.acknowledge({}, status, sequence);
  if (!result.ok) throw new Error(result.code);
  return result.value;
}

const first = acknowledge({tag: 'pending'}, 17);
const repeated = acknowledge(first, 23);
if (first.tag !== 'received' || first.value !== 17 ||
    repeated.tag !== 'received' || repeated.value !== 17)
  throw new Error('A repeat acknowledgment changed the first receipt');
console.log('First and repeated acknowledgments both returned receipt 17.');
