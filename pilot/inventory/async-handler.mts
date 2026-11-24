import {grantLookup} from './verified/module.mjs';

grantLookup('stockroom', ['pencil'], async () => ({tag:'missing'} as const));
