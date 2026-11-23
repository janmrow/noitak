# Noitak 0.4 engineering assessment

Version 0.3 could verify isolated finite decisions, compare contracts and gate an ES module. Version 0.4 can express a module of related state transitions, projections and private operations over structured values. Both proof engines, JS execution, TypeScript declarations and relational change review cover this language fragment.

## What changed

| Area | Implemented decision and trade-off |
| --- | --- |
| Data | Nominal records of scalar and enum fields. Record construction is explicit and ordered. TypeScript exposes readonly structural types and JS checks actual values on entry. Finite products admit exact cardinalities, which grow quickly. |
| Calls | A body can call earlier private helpers with strict, isolated frames. All helper contracts run, and verification includes caller obligations. Embedding each checked callee makes transitive changes visible at the cost of expanded trees. The frontend caps expansion. |
| Security | Each call requires the callee's complete read set. A separate proof can require that both admission and the returned value are independent of named parameters. The gate blocks newly delegated reads and weakened independence. Structured outputs are copied so reference sharing cannot disclose a protected branch. |
| Evidence | Small symbolic proofs and relational results are automatically checked by enumeration. A disagreement blocks publication. Reports identify skipped cross-checks, helper visibility, direct calls and the property checked. |
| Integration | The support pilot verifies structured ticket updates, a customer projection and internal routing in the same module. TypeScript handles storage and dispatch. The delivery pilot and original scalar interface continue to work. |

## Observed results

Validation used Node 22.23.1, TypeScript 5.9.3, Python 3.12.14 and z3-solver 4.13.4.0. Use the setup commands in the [README](../README.md), activate the virtual environment and run from the repository root. Pilot destinations must be fresh.

| Command | Result |
| --- | --- |
| `npm test` | 95 tests passed, including independent emitted-artifact checks and strict TypeScript rejection cases. |
| `npm run test:symbolic` | 26 tests passed, including concrete witness replay, structured hypothetical results and the altered-translator experiment. |
| `npm run pilot:support -- build/support-release` | One accepted helper rewrite, two blocked revisions, four host events, one internal dispatch. |
| `npm run pilot -- build/delivery-release` | One accepted revision and four expected refusals. The host preserved receipt 17 across repeated acknowledgment. |
| `npm run demo` | 65,536 quota inputs verified, TypeScript returned 5 and the broken implementation failed for arguments 1 and 2. |
| `node noitak.mjs test pilot/support/tickets.noi examples/support-vectors.json --json` | All five typed and malformed-input vectors matched. |

A clean copy of the source was exercised with a fresh npm installation and Python virtual environment. Both suites, both pilots and the demo passed there. For each accepted pilot, the ESM, TypeScript declaration, embedded review and manifest were byte-identical to the workspace build. This comparison used the same tool and dependency versions.

The emitted ticket API was independently checked against a hand-written state-transition table for all 3,072 transition inputs and against independent projection and routing rules for 3,072 inputs each. Of the transition inputs, 3,063 are admitted. The nine rejections consist of three public events in each of three ticket stages at revision 255. The artifact oracle uses ordinary host values and its own loops. It shares neither the compiler's enumeration order nor its evaluator as an oracle.

The support gate reproduced two distinct failures. A private note on a closed ticket at revision 255 reached the increment helper outside its precondition. In the other candidate, changing only staff escalation changed the customer waiting indicator. All ordinary contracts passed for that candidate. The independence check supplied both calls and outputs. The accepted helper edit produced an unsatisfiable difference query and 3,063 equal observed returns.

A controlled mutation changed unsigned byte ordering to signed ordering in a temporary SMT translator. The mutated worker certified a property that fails for 255 of 256 byte values and certified equivalence of two unequal implementations. The full build reported `unverified`, the change relation reported `undetermined`, and neither published an artifact. The test demonstrates why successful counterexample replay alone cannot validate a solver's unsatisfiable answers. [Executable experiment](../tests/symbolic/composition.test.mjs)

## Migration and limits

Existing 0.3 function, enum and contract syntax is accepted subject to the new expanded-body size and depth limits. Existing `api.method(flags, ...args)` calls keep their positional interface. Use `Object.hasOwn(api, name)` if inspecting the generated API; its prototype is now null. Generated result declarations include two inner-contract fault codes. TypeScript consumers with exhaustive error switches should handle those codes. Only well-typed, admitted inputs to successfully verified functions receive the execution guarantee.

Function reports move from schema 2 to 3 and diff reports from 3 to 4. Index obligations by function and property, require the process to succeed, and check the aggregate `passed`. Regenerate artifacts and evidence with the new toolchain. Module source versions remain application-chosen.

The compiler, checked IR, runtime and delivery of the right artifact remain trusted. The independently implemented SMT encoding shares the frontend with enumeration. Above the cross-check budget a symbolic proof additionally relies on the translation and solver. Timing, host authorization, hostile realms, persistence, operational resource quotas and the accuracy of product requirements remain outside the proof. Records cannot contain records. Bytes constrain practical revision counts. Whole-program expansion and finite enumeration restrict scale. [Verification details](verification.md)

The proposed 0.5 milestone moves bounded event batches and cross-module composition into the verified fragment. Its acceptance criteria include atomic batch semantics, authority propagation and behavioral review across an imported dependency. [0.5 roadmap](roadmap.md)
