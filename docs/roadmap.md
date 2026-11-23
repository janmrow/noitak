# Noitak roadmap

## 0.7 disposition

Checked JavaScript lowering and typed record readers moved IR dispatch and lexical maps out of the shipping artifact. The verifier retains its interpreter. The gate tests the emitted module in a separate worker and records comparison coverage. The metering and tenant workloads now run several times faster, with a measurable increase in bundle creation time. [0.7 evidence](release-0.7.md)

The remaining adoption question is how to exercise the paths an application depends on when few typed inputs pass admission. The new checker can return precise evidence of zero admitted samples. Existing source vectors and strict host tests provide application examples. A future milestone could bind independently owned application cases to the reviewed bundle and measure how often they add coverage beyond generic probes. The correctness of a business specification and real host authorization remain external decisions.

## Original 0.7 proposal

The metering reducer moved the ordering loop, checked quantities, and tenant-sized identifiers into Noitak. The invariant proof cost is independent of batch length, while the runtime cost grows with each reading. The interpreter dispatches IR, allocates lexical environments, copies inputs, and reevaluates contracts throughout the loop. The independent TypeScript model is much faster on trusted values. The benchmark measures the aggregate and does not attribute it to individual operations. [0.6 measurements](release-0.6.md)

Prioritize an efficient checked execution backend. Profile snapshots, expression evaluation and contract checks separately. Lower checked expressions to structured JS or a compact instruction sequence while preserving boundary validation, checked arithmetic, selected-branch evaluation, fresh results and the approved artifact identity. Keep the current evaluator as an independent differential oracle. Acceptance should include the existing tenants and metering workloads, fault-phase agreement, change-gate evidence, throughput and allocation measurements on valid and rejected batches. Reassess the priority if real consumers spend most of their time elsewhere.

A future effect system could represent external operations as typed requests whose construction requires a declared capability. A trusted host would interpret requests and provide typed replies, with authority changes visible to the gate. Issuance of a request could be verified. Successful I/O, fresh data, transaction isolation and host compliance would require separate assumptions. The current workloads need only decisions and pure transitions, so a general I/O layer can wait.

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
