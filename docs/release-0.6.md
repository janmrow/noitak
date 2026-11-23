# Noitak 0.6 engineering assessment

This experimental release supports components that reconcile thousands of records or make decisions over full-width tenant and resource identities. The v0.5.0 compiler at `09ceeae` rejects both new workload sources at the UUID field. Its byte integers and eight-element folds place the wide quantities and outer processing loop in the host.

## Workloads and evidence

| Component | Formal obligations | Independent execution evidence |
| --- | --- | --- |
| Metering | On every admitted transition, usage stays within quota, meter and limit are preserved, accepted usage and serial advance exactly as specified, and rejection preserves the previous quantities. A non-ready state is sticky. The invariant holds after every prefix, including the empty prefix. | Generated ESM compared with a separately written strict TypeScript model using BigInt, short-circuit iteration and direct record updates. Cases include 8,192 accepted readings, 96 injected errors at different positions, and the u32 endpoints. |
| Tenant access | A suspended principal is revoked. Cross-tenant access is denied. A same-tenant owner can read. A delegated decision requires an enabled grant, a matching active reader and strictly unexpired access. Admission and the complete decision are independent of the trace UUID. | The generated artifact matched an independent priority table on 384 cases spanning ownership, grants, suspension, tenant equality, expiration and two trace values. |

For metering, a first rejection is represented in the returned state. The component can return quantities accumulated before rejection. The TypeScript store commits only a ready result. The installed-package check submitted a 1,001-reading request that exceeded quota on its last reading and left the store unchanged, then committed the valid 1,000-reading request. The store is a synchronous in-memory example. Storage consistency across writers belongs to the host. The metering contract constrains acceptance and numeric safety. Some exact rejection-code choices are covered by the reference model and equivalence review rather than the step guarantee. [Metering](../pilot/metering/metering.noi) · [Independent TS model](../pilot/metering/reference.mts) · [Access policy](../pilot/access/access.noi)

## Design and change control

Unsigned 32-bit quantities map exactly to ordinary host numbers. UUIDs cover the full 128-bit domain with one canonical textual representation. The narrower identifier type makes it possible to verify common identity comparisons without trusting string normalization. General text processing, signed arithmetic and floating point remain open. The host validates shape, range, own data properties, dense arrays and grants on entry. Bounds on copied values, step count and declared capacity constrain reducer calls. The static work metric excludes structural comparison cost, JS allocation and Proxy traps. The design addresses overflow, input validation and authorization errors. [CWE-190](https://cwe.mitre.org/data/definitions/190.html) · [CWE-20](https://cwe.mitre.org/data/definitions/20.html) · [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)

A reducer keeps only an accumulator, and its transition must preserve a declared invariant for **every** admitted state and typed row, including states unreachable from a particular application's initial value. This stronger premise makes proof independent of batch length. It can force the author to strengthen an invariant or retain information in the state. The report distinguishes the step proof, induction rule, static checks and runtime enforcement. Small programs can still use exact arbitrary sequence predicates over bounded folds. There is no general induction prover for collection algorithms. [Language](language.md) · [Proof and trust model](verification.md)

The gate accepted a rewrite that swapped the operands of checked addition in metering. Replacing the foreign-meter rejection code with out-of-order passed the individual contracts but yielded a concrete one-transition behavior difference. Removing the authorization tenant check violated the original contract. Changing both the implementation and the requirement produced individually proven revisions and distinct contract and behavior witnesses. Reducing a reducer capacity is an interface risk. Increasing it requires review under the resource policy. A missing proof blocks publication. The root instructions keep these rules discoverable, drawing on project-context guidance from [Codex](https://developers.openai.com/codex/guides/agents-md/), [Claude Code](https://code.claude.com/docs/en/best-practices), [Gemini CLI](https://geminicli.com/docs/cli/gemini-md/) and [Meta's Momentum repository](https://github.com/facebookresearch/momentum/blob/main/AGENTS.md).

## Measurements

The following local Linux measurements used Node 22.23.1, Python 3.12.14, Z3 4.13.4 and TypeScript 5.9.3. Each median uses five samples after two warmups. Proof timings exclude parsing and include Python worker startup when symbolic. The small parity case isolates the cost of enumerating sequences. It checks safe execution with a trivial invariant. The workloads above exercise stronger requirements.

| Case | Evidence or size | Median |
| --- | ---: | ---: |
| v0.5 parity fold, capacity 8 | 1,022 enumerated calls | 3.592 ms |
| v0.6 parity reducer, capacity 8 | 4 enumerated transitions | 0.063 ms |
| v0.6 parity reducer, capacity 8,192 | 4 enumerated transitions | 0.017 ms |
| Metering verification, including helper and derived invariant | 10,793-byte ESM | 339 ms |
| Access verification, including independence | 9,720-byte ESM | 151 ms |
| Run 8,192 valid readings through generated metering ESM | snapshot, contracts and checked steps | 44.33 ms |
| Same canonical readings in strict TS reference | trusted-input business calculation | 0.153 ms |

Runtime overhead is substantial on this workload. The reference assumes typed, admitted plain data and omits descriptor snapshots and executable contracts. This comparison measures the cost of the two complete paths on valid data. It cannot isolate the cost of verification, host validation or IR interpretation. Above the cross-check ceiling, full-domain symbolic proofs trust the translator and Z3. Witness replay can confirm reported counterexamples. The independent tests sample the artifact and the reducer loop. They do not establish backend equivalence.

```sh
baseline=$(mktemp -d)
git archive v0.5.0 | tar -x -C "$baseline"
node scripts/bench-reducers.mjs "$baseline"
node scripts/bench-reducers.mjs .
```

## Reproduction and migration

Install and activate the dependencies in the README. Use fresh output directories.

```sh
npm test
npm run test:symbolic
npm run pilot -- build/v06-delivery
npm run pilot:support -- build/v06-support
npm run pilot:batch -- build/v06-batch
npm run demo
npm run release:check -- build/v06-dist
```

The v0.5.0 baseline passed 103 default and 31 symbolic tests. On 0.6, 112 default and 38 symbolic tests passed, along with the three earlier pilots and demo. The complete support batch still agreed with its independent host model on all 261,120 cases. The new CLI refusal test also removed the solver from the process search path. Auto-mode checks stayed unverified, the induction premise was missing, and the gate created no destination.

The final command packages and installs the tarball offline in a fresh consumer, gates a pinned support graph, gates a metering update, compiles the supplied strict TS service, and runs the resulting ESM. TypeScript and Z3 are build tools. The checked module has no external runtime dependency. TypeScript's number and string types still admit values rejected by the runtime. Build output directories are single-use and promotion of a verified bundle remains an application concern.

Ordinary functions, folds, pins and positional host calls keep their 0.5 behavior. Source types formerly named `u32` or `uuid` need renaming. Function reports move to schema 5 and change reviews to schema 6. Index obligations by function and property. Inspect `scope`, `method`, `premise` and `capacity` on reducer checks. The original default remains enumeration. Use `--engine auto` in a solver-equipped build to select the method per obligation. A four-transition proof under `--engine enumerate --limit 3` stays unverified, and its induction conclusion is withheld. Worker timeouts, invalid responses and engine disagreements still fail closed.

Source loading and type checking, induction lowering, evaluation and JS generation, solver translation and Z3, Node, Python, and artifact delivery remain trusted as applicable. The host authenticates principals and supplies current policy facts, time and grants. No external effects are executed by Noitak. The next proposed milestone targets execution overhead while retaining the present evaluator for differential checks. [Roadmap](roadmap.md)
