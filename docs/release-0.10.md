# Noitak 0.10 engineering assessment

Version 0.10 makes ordinary functions the place to compose data processing.
A function can build an intermediate collection, pass it to a private
helper or a reducer, and state a contract over the complete returned value.
It can use that computation as a stage of a capability-scoped host service.
The change gate retains exact semantic comparison and can record independent
authorization for specific witnessed behavior changes.

The baseline is v0.9.0 at `7b9401829f0ee63c92d354ce86dbba18f305a299`.
It already supported pinned sibling modules, tagged and structured types,
ordinary folds, mandatory source proofs, inductive reducer entries and
ordered collector entries. It lacked a way to grow a sequence within an
ordinary expression or invoke a reducer from one. A collector could return
a filtered sequence from a single selector but could neither compose inside
a function nor state a complete-output contract. Symbolic safety used exact
implementations, and each side of a gate rechecked its reachable graph.
Read flags came from a snapshot supplied by the host.

## Architecture and assurance

| Decision | Implemented mechanism and trade-off |
| --- | --- |
| Compose bounded computations | Keep immutable acyclic expressions and add checked append and reducer composition. A named reduction lowers to a guarded typed fold. A record or tagged accumulator can retain several values, collections or a business rejection. Existing reducer and collector entries retain their independent induction rules. General loops could enable more programs but would require a termination policy and new obligations for arbitrary state. |
| Grow practical domains | Add signed i32 using checked arithmetic and signed symbolic bitvectors. Make u32 indexing opt-in per sequence type. Array bounds, type layouts, conservative expression work and solver budgets apply independently. Native sequence terms avoid enormous sum types. Append copies its prefix, and repeated append can take quadratic work. |
| Verify with proved premises | Auto mode uses proven contracts to abstract eligible calls on large finite domains. It retries a potential abstract counterexample with exact terms. It leaves timeouts and unknowns open. It uses exact terms for text input domains because abstract bounds made a legacy text query inconclusive. Explicit symbolic mode uses exact implementation terms. |
| Reuse evidence locally | Diff and gate share an invocation-private table of successful function obligations. Keys include the checked definition, dependency keys, graph pins, type layouts, tool version and proof configuration. Evidence lists stable obligation identifiers and dependency digests. Import pin changes conservatively invalidate the invocation’s reuse. No serialized proof inputs are accepted. |
| Mediate one real host read | A checked planner computes the key. A host-minted opaque token carries an exact resource and key set. The runtime validates authorization, input and reply, invokes a synchronous handler once, and passes the reply to a verified continuation. A thrown handler becomes a tagged unavailable reply. Modeling the operation at a service boundary keeps host behavior out of pure proof assumptions. |
| Independently authorize evolution | The protected caller supplies a policy scoped to source digests, pins, compiler version and configuration. It can accept exactly the named witnessed return differences. Changed requests, lost guarantees, added authority and unresolved proofs block publication. The receipt retains the actual change witness and policy digest. |

Source typing checks nominal values and transitive flag requirements. Runtime
checks enforce arithmetic bounds, shape and capacity, contract admission,
postconditions and token scope. Finite enumeration and symbolic checks prove
declared properties of the checked source domain. A reducer’s finite input
bound gives its traversal termination independently of its invariant proof.
Source safety and whole-collection length contracts have formal evidence.
Application vectors and independent models test order, payloads and exact
business behavior of shipped code.

Observable independence for ordinary functions still covers admission and
successful returned values on valid inputs. Lookup requests make occurrence,
resource and key observable. Those traces have no claimed noninterference
proof. The gate conservatively blocks planner changes, and the host remains
responsible for issuing grants, choosing the resource, protecting its own
credentials and data, and bounding handler execution.

The trusted base includes type checking, checked IR and bounds, the solver
encoding, Z3, exact hash/linking, the reducer and collector inference rules,
and the trusted CLI and deployment policy. Symbolic witnesses replay in the
interpreter. Definitive proofs over small domains can be vetoed by
enumeration. Shared parsing, value semantics and decoders can still create
common-mode errors. The artifact worker applies a deadline and V8 resource
limits, and its OS privileges are those of the compiler process. Source
proofs do not establish backend equivalence. [Verification](verification.md)

## Practical workloads

- **Cold-chain shipment assessment.** An imported policy classifies signed
  samples against inclusive range endpoints. A private fold filters
  uncalibrated readings and collects excursions. The public function
  aggregates them into a quarantine decision and proves a result length
  bound and independence from a private note. Six independently specified
  artifact vectors cover empty inputs, edges, signed extremes, order and
  duplicates. The benchmark also checks malformed data and both note values
  against each implementation. [Shipment source](../pilot/coldchain/shipment.noi)
- **Inventory replenishment.** A strict TypeScript consumer authorizes two
  SKUs in a host stockroom map. Noitak validates the order, looks up current
  stock through the scoped grant, distinguishes missing and unavailable
  responses, and computes whether to order or report an invalid balance.
  The independent numerical oracle matched 150 stock allocations plus
  three admission, scope and missing-data cases. Artifact validation
  exercises seven handler scenarios per service. A mutation that bypassed
  the key check failed artifact validation. [Inventory source](../pilot/inventory/inventory.noi)

Both generated APIs are consumed with `tsc --strict --module nodenext`.
The packaged CLI builds the same services from the installed tarball with
pinned dependencies and emitted declarations. Hosts can deploy the ESM on
its own. Build-time Python and Z3 stay on the verification side.

## Comparative change benchmark

The benchmark compiles an independent TypeScript implementation with strict
typing and runtime validation. The common requirements and acceptance inputs
live outside each candidate. Both valid changes pass the acceptance tests.
Noitak’s gate checks additional contract, authority and dependency metadata.
The corresponding rows have no TypeScript mutant of that metadata. The
benchmark uses deterministic edits. No genuine coding-agent trials,
model comparisons, repair attempts or human intervention measurements were
conducted.

| Change | Noitak | TypeScript |
| --- | --- | --- |
| Equivalent threshold rewrite | Compatible | Accepted |
| Quarantine on first excursion | Strict review blocks. Exact authorization accepts | Accepted with updated requirements |
| Off-by-one threshold | Return difference | Tests reject |
| Ignore sample calibration | Return difference | Tests reject |
| Private note controls quarantine | Independence proof violated | Tests reject |
| Drop a rare but valid signed reading | Return difference | Escapes acceptance tests. An independent holdout confirms the defect |
| Weaken complete result guarantee | Contract refinement fails | — |
| Require extra authority | Authority policy blocks | — |
| Stale dependency pin | Source loader rejects | — |

Of the common tasks, Noitak accepted both valid changes and rejected four of
four defects. TypeScript accepted both valid changes and rejected three of
four defects. All three additional Noitak policy mutations were refused.
The exact body checks returned replayable witnesses. The release benchmark
had no open required source obligations for loadable candidates. The reuse
table skipped two of three verification groups for threshold-only edits.
Changing the private selector invalidated that group and its public caller
while retaining the imported temperature-policy proof. The unit suite
tests invalidation on pin and configuration changes and refusal to reuse
failed obligations.

A local Node 22.23.1 and Z3 4.13.4 run verified the shipment in 283 ms and
built it in 328 ms. Gate times for loadable candidates ranged from 373 to
579 ms, excluding the preliminary authorization diff. The combined strict
TypeScript compilation took 843 ms. The TypeScript acceptance checks took
0.17 to 1.06 ms per candidate after compilation and process startup.
Median execution measured 1.047 µs per generated call and 0.397 µs for the
validated TypeScript implementation on the same three-row input. This
single-machine benchmark includes Noitak’s executable contracts and boundary
copies and does not attribute cost to individual checks. Each run writes
fresh timings and machine-readable decisions under its destination.

A capacity experiment changed both shipment sequence capacities together.
The same source-level checks proved at capacities 3, 4, 8 and 16 in
0.30, 0.32, 0.59 and 1.30 seconds respectively. At 32 the run took 6.41
seconds and left three obligations open after solver cancellation. The
static work estimate grew from 137 at capacity 3 to 2,051 at 32. This
program remains much smaller than the largest accepted input type.
Wide sequence tests separately exercise concrete positions across 255 and
up to 512. Host reducer proofs still quantify one transition independently
of batch length. The measured 32-row ordinary fold is the clearest limit
on the next scale increase.

## Reproduce the release checks

With the pinned Python environment active and Node 22 on PATH, run from the
checkout. Baseline verification ran 132 default tests and 47 symbolic tests
successfully at v0.9.0. The release workflow uses fresh destinations.

```sh
npm ci --offline --no-audit --no-fund
npm test
npm run test:symbolic
npm run demo
out=$(mktemp -d)
npm run pilot -- "$out/pilot"
npm run pilot:support -- "$out/support"
npm run pilot:batch -- "$out/batch"
npm run pilot:components -- "$out/components"
npm run pilot:collect -- "$out/collect"
npm run pilot:inventory -- "$out/inventory"
npm run bench:changes -- "$out/shipment"
npm run release:check -- "$out/distribution"
```

The batch pilot checks 261,120 outcomes against its independent transition
model. Legacy collector tests include a reversed-emission mutation. Signed
tests use a BigInt arithmetic oracle. Artifact and solver tests cover
malformed evidence, timeouts, missing admitted execution, boundary faults
and contradictory solver replies. The release check exercises a fresh
offline tarball install and validated artifacts from both new pilots.

The local release run passed 143 default and 54 symbolic tests, the demo,
all six pilots, the change benchmark and the installed-package check.
To reproduce the capacity measurements with the same engine and budgets:

```sh
scale=$(mktemp -d)
cp pilot/coldchain/limits.noi "$scale"
for capacity in 3 4 8 16 32; do
  sed -e "s/samples sample 3/samples sample $capacity/" \
      -e "s/temperatures i32 3/temperatures i32 $capacity/" \
      pilot/coldchain/shipment.noi > "$scale/shipment-$capacity.noi"
  time node noitak.mjs verify "$scale/shipment-$capacity.noi" --engine auto --json
done
```

## Migration and next milestone

Existing entry points retain positional JS calls and byte sequence indices
unless the source opts into u32 indexing. A pre-existing nominal type named
`i32` needs renaming. Consumers that exhaustively match the generated
`Result` error codes should add `CAPACITY`. Lookup enabled modules add
`services`, `grantLookup` and a lookup-specific failure code. Proof and review
reports add evidence fields. Machine consumers should use obligations by
identity and keep semantic findings visible when the decision is
`authorized-evolution`. The default remains enumeration for installations
without a solver. Use `--engine auto` for large-domain builds. The gate also
checks refinement of retained private helper contracts and blocks removal
of helpers with nontrivial clauses or independence obligations.

The next milestone should bring inductive invariants to composed folds and
extend proofs to lookup traces. Current programs remain bounded, synchronous
and acyclic, with no general heap, recursion, external writes or concurrency.
Proof reuse stops at the invocation boundary. Formal verification of the
compiler and hosted CI results are outside the local evidence. [Roadmap](roadmap.md)
