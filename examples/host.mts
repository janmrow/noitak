import { api } from './quota/module.mjs';

const balance = api.remaining({}, 8, 3);
if (!balance.ok) throw new Error(balance.code);
console.log(balance.value);
