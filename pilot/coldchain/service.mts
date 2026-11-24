import {api, type Record_sample} from './verified/module.mjs';

export function receiveShipment(samples: readonly Record_sample[], internalNote: boolean) {
  return api.assess({}, samples, internalNote);
}
