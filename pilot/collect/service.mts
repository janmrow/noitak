import {api, type Record_events$envelope, type Record_events$job, type Result} from './verified/module.mjs';

export function collect(deliveries: ReadonlyArray<Record_events$envelope>): Result<ReadonlyArray<Record_events$job>> {
  return api.queued_jobs({}, deliveries);
}
