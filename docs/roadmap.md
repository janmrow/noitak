# Noitak roadmap

## Original 0.5 proposal

The support service currently owns the event loop. Version 0.4 proves each transition and the customer projection. It leaves ordering, stopping at the first inadmissible event and atomic publication of a successful batch to the host. Its private-call representation also duplicates checked bodies when serialized. A realistic next milestone is a reusable transition module and a verified bounded batch processor, exercised by an ordinary TypeScript caller.

| Priority | Work | Engineering reason and cost |
| --- | --- | --- |
| 1 | Introduce a shared, typed function graph with stable binding identities and explicit imports by module identity and digest. Keep calls acyclic. | Expanded helper trees already require a size cap. A graph permits sharing and precise dependency attribution. Medium implementation cost, high verification impact. |
| 2 | Define bounded immutable sequences and a fold with an explicit accumulator and typed failure result. Specify evaluation order, length, maximum work and the observable index of failure. | This moves the host's first substantive control-flow operation into the verified component. Encoding and comparison cost are high. Begin with small fixed capacities and short batches. |
| 3 | Verify calls against module contracts with explicit caller obligations. Bind proof reuse to the checked definition, interface, type layouts, policy, verifier version and dependency digests. | Summaries can avoid expanding every implementation. An under-specified summary cannot establish equal returned values. Keep whole-program comparison or report unknown wherever the summary is insufficient. |
| 4 | Extend the support pilot to import the transition module and apply an ordered event batch. Prove that a rejected batch exposes no partial public update and preserves staff-data independence, including the reported failure index. | This gives the data model, effect boundary and verifier a single acceptance test. Keep actual persistence and transaction isolation in the host. |

Preserve immutable values, explicit capability snapshots, nominal source types, typed host validation, counterexample replay, two distinct proof engines and atomic gated publication. Keep the table-driven artifact oracle as an independent specification. Reconsider the per-function enumeration ceiling using measured batch lengths and record widths. Replace tree expansion only after the graph backend agrees with the 0.4 semantics on every existing pilot and negative case.

**Acceptance evidence.** Run batches of lengths zero through a small configured maximum against an independent sequential model. Demonstrate explicit refusal for excessive length and verifier budget exhaustion. Gate a behavior-preserving imported helper edit. Reject reordered events, hidden changes to partial-commit semantics, loss of a protected observation and added authority. Show which export depends on the edited module and bind its digest into the deployed evidence. Benchmark proof time, generated size and comparison cost against 0.4 expansion on a shared call graph.

A larger revision counter would improve the pilot's deployment fit, but widens every product domain and warrants proof-cost measurements first. Heap mutation, concurrency and additional execution targets would introduce separate aliasing, scheduling and backend-equivalence obligations. Sequence processing and cross-module proof reuse have the clearest immediate application.


## 0.5 disposition

The release implements pinned sibling modules, acyclic linked frames, exact per-worker symbolic call summaries, indexed folds over bounded sequences, typed attempted calls and a batch host. The accepted imported rewrite has both a library-level and a root-export comparison. Full enumeration and an independent artifact oracle cover every input in the batch pilot. [Release evidence](release-0.5.md)

Persistent proof reuse remains deferred. Each new invocation re-verifies sources and pins. The current worker can share exact symbolic terms within a query and keeps each revision's graph separate. This avoids introducing a trusted cache format for the first cross-module release.

The next deployment question is how proof cost changes for larger application counters and longer real event streams. Use consumer workloads to measure the cost of wider bounded integers, cancellation and verification resource budgets before extending the present limits. A durable proof cache would first need replayable evidence, toolchain identity and transitive invalidation tests.
