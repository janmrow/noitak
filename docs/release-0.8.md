# Noitak 0.8.0 engineering assessment

A TypeScript service can now pass a nested event or access request directly to a contracted Noitak component. Version 0.7 could represent a UUID, a flat record and a short sequence, or process a larger array at a reducer entry. It could not represent a webhook envelope containing an optional structured push, inspect its branch name, and search 128 labels in an ordinary function. Version 0.8 implements that component and a tenant-scoped topic policy. The baseline for this assessment is the local v0.7.0 tag at `96a5b14`.

## Design and compatibility

Text uses JS UTF-16 value semantics throughout the frontend, reference interpreter, SMT encoding, emitted JS and TypeScript interface. Exact prefix, suffix, substring, prefix removal, equality and length support routing and normalization of bounded fields. Every operation stays within the 1,024-unit text bound. Explicit tagged absence makes a missing business value distinguishable from malformed input. Acyclic nominal types can nest and refer forward. Expanded layout and depth checks reject recursive or exponentially expanding declarations.

First-class sequences accept up to 255 elements, preserving byte lengths and indices. Structural membership evaluates its needle even on empty input. A host-only loop would move label selection outside the verified component. Raising the old datatype limit alone would give the solver a constructor for every length and quadratically many selectors. Capacities above eight use native SMT sequences. Existing small domains retain the earlier datatype encoding and exhaustive checks. Large streaming reductions retain their invariant-based entry convention.

The compiler reserves the scalar type name `text`. An older user type with that name needs renaming. Exceptionally wide source layouts can now exceed the expanded-layout limit. Shapes accepted by a previously declared capacity retain their boundary convention. Increasing a sequence capacity now raises a resource-policy finding, even though old calls still fit. Function report schema 7 and diff schema 8 include the new evidence. Consumers must handle the `symbolic-text` domain descriptor. Use `--engine auto` or `symbolic` for text-containing input domains. [Language specification](language.md) · [Proof and comparison](verification.md)

## Workloads and proof cost

The webhook dispatcher distinguishes invalid or missing branch refs, unrelated events, archived repositories and deleted branches. A queued job carries the repository, branch with one prefix removed, and an urgency bit. The public guarantee proves that a queued job refers to the input repository, has a nonempty branch, comes from an active repository and has exactly the urgency indicated by membership of the label. The helper separately proves its prefix transformation. Input authentication and actually starting a job belong to the host. [Component](../pilot/events/events.noi) · [Expected host outcomes](../pilot/events/vectors.json)

The topic service proves that an allow decision requires a live actor in the same tenant, a nonempty key, the exact or descendant grant, and the named capability for protected topics. The complete observable result and admission are independent of the trace parameter. Topic keys are opaque, case-sensitive strings. A host using filesystem, URL or broker-specific normalization must establish the intended identity before calling. [Component](../pilot/topics/topics.noi) · [Strict consumer](../pilot/topics/service.mts)

In one local run the full event verification took 219 ms and a build including proof took 267 ms. For topics these were 128 and 162 ms. Both use Z3 for safety and a checked nonoccurrence rule for independence. Closed call frames allow that rule to avoid a second symbolic execution when the protected parameter has no reference in the contracts or body. A live reference still requires relational reasoning. All checks of admitted behavior assume valid inputs and fixed grants.

The following experiment kept the event guarantee and changed only capacity and the body used to compute urgency. Times include CLI startup and all module obligations. The fold accumulated the same disjunction in order. Unknown results remain in the generated comparison report.

| Maximum labels | Membership primitive | Explicit fold |
| --- | --- | --- |
| 4 | Proven, 213 ms | Proven, 216 ms |
| 16 | Proven, 207 ms | Unverified, incomplete sequence theory, 239 ms |
| 128 | Proven, 206 ms | Unverified, solver canceled at the query budget, 3,277 ms |

Nested text-length comparisons initially exhausted the three-second query budget on a two-element record collection. Keeping comparisons involving a converted length in integer arithmetic, with the exact unsigned modulus, let the pinned worker discharge both the safety and hypothetical-result queries. A regression exercises the nested bound. Larger domains still depend on the translation and solver for unsatisfiability. There is no independently checked proof certificate.

## What a successful build establishes

| Evidence | Scope |
| --- | --- |
| Static enforcement | Nominal types, complete matches, bounded acyclic layouts and work, explicit transitive reads and isolated call frames. |
| Formal obligations | Nonempty admission, safe contracts and successful admitted executions for each checked function. Declared independence and reducer induction are separately identified. Authors choose behavioral postconditions. A weak postcondition can admit incorrect product behavior. |
| Runtime enforcement | Exact arity, own data properties, dense sequences, bounded strings, checked arithmetic, snapshotted grants and executable contracts. Structured outputs are freshly materialized. |
| Artifact tests | For each export the comparison exercises at least one admitted body, including a nonempty batch for a reducer. An external vector file can additionally require exact outcomes from the emitted API. |
| Outside the evidence | Host privileges, actual identity and grant issuance, endpoint authentication, queue delivery, timing confidentiality and universal compiler correctness. |

The source proof supplies a concrete admitted assignment. Z3 models are validated and replayed, and finite enumeration retains a successful assignment. In the old rare-u32 fixture none of the 64 generic positions returned. The new witness executes value 7 and exposes a deliberately changed emitted return. Zero admitted bodies now produces incomplete validation and blocks publication. Wrong-arity and missing-grant probes have independent expected errors. One intentional translator mutation is now detectable during admission replay, before enumeration, depending on the model selected.

For the event artifact, 24 of 26 calls returned successfully, including tests drawn from eight externally supplied vectors. For topics, 22 of 24 returned, with five external vectors. Both manifests bind the vector-file bytes to the result. Counts include repeated inputs and give no estimate of path coverage. The parser, type checker, model translation, solver, backend, JS runtime and shared boundary/equality helpers remain trusted. A reviewed baseline and any required external examples must come from an authority outside the candidate. A policy change can be promoted by reviewing a new baseline outside the module. [Architecture](architecture.md)

## TypeScript comparison

The TypeScript implementation checks primitive values, UUID spelling, nested grants, own data properties, arity and the capability at runtime. Its strict type check and the generated consumer both ran with TypeScript 5.9.3. An independently specified decision table, five application vectors and malformed-boundary cases exercised 372 calls on each implementation. The experiment compiled two isolated source edits to both implementations. [TypeScript baseline](../pilot/topics/reference.mts) · [Experiment](../pilot/topics/compare.mjs)

| Edit | Strict TypeScript and tests | Noitak |
| --- | --- | --- |
| Include the subtree root as its own descendant | Typechecked. Three cases failed. | Allow contract violated. Gate refused in 211 ms. |
| Change the denial reason for protected topics | Typechecked. Six cases failed. | Candidate safety proof passed. Baseline comparison found different returned decisions. Gate refused in 317 ms. |

Both Noitak witnesses also distinguished the TypeScript mutant from its baseline. Ordinary tests caught both edits. The gate provided a concrete distinguishing input without requiring the reviewer to anticipate it. The denial-reason edit illustrates how much a standalone proof depends on the chosen contract.

The generated component took 1.777 µs per typed host call against 0.419 µs for TypeScript in this run. Each figure is the median of five warm trials of 100,000 mixed calls after one warmup. Both include boundary validation and construction of a public reply. Noitak also evaluates the source contracts and materializes a fresh return. The measurement does not isolate the cost of each operation. The strict compile of the baseline and generated consumer together took 857 ms. These local timings have no CI performance threshold.

## Reproduce

Run in a fresh checkout with Node 22 and the pinned Python environment active. The measured environment used Node 22.23.1, npm 10.9.8, Python 3.12.14 and Z3 4.13.4. Commands below use fresh output directories. The local dependency install used `npm ci --offline --no-audit --no-fund` with a populated npm cache.

```sh
npm ci
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-symbolic.txt
npm test
npm run test:symbolic
npm run demo
npm run pilot -- build/0.8.0/rc/pilot
npm run pilot:support -- build/0.8.0/rc/support
npm run pilot:batch -- build/0.8.0/rc/batch
npm run pilot:components -- build/0.8.0/rc/components
npm run release:check -- build/0.8.0/rc/distribution
```

The core suite passed 126 tests and the symbolic suite passed 45. They include exact UTF-16 code-unit oracles, malformed and aliased nested values, strict membership, symbolic and enumerated bit sequences, imported transform changes, solver and emitter mutations, admission replay and external-vector vetoes. The delivery pilot accepted one revision and refused four. Support accepted one and refused two. Batch accepted one and refused five and matched 261,120 emitted results to its independent model. The distribution check installs the tarball offline and exercises the packaged compiler, pinned modules, strict consumers and the topic vector digest.

## Next milestone

Implement a compositional filter or projection over bounded collections. The event service can select a label, but a host still builds a dynamically sized collection of accepted jobs. The fold experiment shows where generic unrolling already loses the ability to prove a simple selection property. Use the ordered output, capacity, per-item guarantee and a change that loses or reorders jobs as the next acceptance case. [Roadmap](roadmap.md)
