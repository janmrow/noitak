# Implementation

## From source to a checked program

The CLI decodes UTF-8 strictly and retains original bytes for hashing. The parser builds located atoms and lists. The frontend indexes nominal declarations and resolves field, element and payload dependencies on demand, checking cycles and expanded layout bounds. It checks functions in source order, with a separate environment of previously checked private helpers. Lexical scopes and capability names use maps. The resulting expression tree contains literals, variable names and fixed operator tuples. [Parser](../src/parser.mjs) · [Frontend](../src/frontend.mjs)

The loader reads a bounded source graph, checks identity and SHA-256 at each edge and resolves a dependency once per revision. Transitive imports share the same nominal type objects. Qualified module and function names identify imported frames. Each checked call stores a target and actual arguments. The frontend collects the reachable definitions for each entry, and the backend emits one set of JS predicates and a body for each reachable frame. A conservative work budget includes all callees, contracts and bounded fold iterations. [Loader](../src/loader.mjs) · [Execution rules](language.md)

Each helper must prove its contract over its own declared domain, including when it has no callers. Each strict caller must prove admission at each reached call. An attempted call must safely evaluate admission and handles a false predicate as a typed rejection. Calls cannot occur in contract expressions. This keeps a helper edit from implicitly rewriting the requirement against which the caller is measured.

## Execution and boundaries

The evaluator implements strict call frames, checked arithmetic, structural value equality and lazy selected branches. Host entry validates positional arguments and snapshots named grants once. Record and tagged fields must be own data properties. The exit boundary materializes a fresh result tree. This last copy matters for independence: two equal fields must have the same observable value semantics even if the computation reused a single object in one branch. A host cannot distinguish those branches by comparing returned field identities. [Runtime](../src/runtime.mjs)

The backend lowers checked expressions to standalone ECMAScript. Each frame has admission, body and exit functions. Lexical bindings use compiler-generated identifiers, with quoted strings for field names, tags and grants. Conditional expressions and short-circuit operators preserve selected-branch evaluation. A fold becomes an ordered loop, and strict or attempted calls evaluate their actuals before entering the selected frame. Pure bundles export a frozen, null-prototype API object. Lookup bundles also export the service table and host grant constructor. Private helper implementations can be inspected in the artifact and invoked only through compiled calls in its public API. The build also emits structural TypeScript declarations and artifact digests. The artifact contains static JS. It requires no runtime parser, dynamic code evaluation or IR interpreter. The verification interpreter remains a separate implementation. Both paths share scalar checks, grant snapshots, structural equality and fault vocabulary. For boundary records of up to 32 fields, generated readers validate each own data property in declaration order and construct a fresh ordinary object. Wider records use the generic decoder. [Artifact builder](../src/backend.mjs)

## Verification and review

The finite engine enumerates products in mixed radix using exact integer cardinalities. It uses the runtime evaluator. The symbolic engine translates the same checked trees to Z3 data values plus safety predicates. Records become single-constructor algebraic datatypes. Helper arguments, admission, execution and the guarantee each contribute a safety condition when the call is evaluated. A conditional or match guards the safety of the selected branch. Worker models pass through the JS boundary before they become reported witnesses. [Domain](../src/domain.mjs) · [Verifier](../src/verify.mjs) · [Worker](../src/symbolic_worker.py)

The frontend records parameter references during checking. With closed call frames, absence from all contracts and the body proves independence structurally after safety succeeds. Enumeration compares the complete outcomes of concrete calls against reference calls with fixed protected arguments. Symbolic checking constructs a second evaluation in a fresh lexical frame, proves equal admission and compares values on admission. On small domains a separate enumeration checks definitive solver verdicts and can veto them. The two engines share source resolution and checked IR. A separately written transition table exercises the public artifact to cover part of that shared trust boundary. [Independence](../src/independence.mjs) · [Cross-check](../src/crosscheck.mjs) · [Artifact oracle](../tests/composition.test.mjs)

The gate verifies both source snapshots, analyzes their policy and semantics, then builds the in-memory candidate already tied to the review. Public body comparison includes reachable frame definitions. Each revision uses its own frames when the two solver terms are compared. Contract refinement still compares hypothetical results independently of either body's observed return. The CLI is the supported verification and publication boundary. Internal JavaScript compiler functions accept trusted IR and reports. [Change comparison](../src/diff.mjs) · [Refinement](../src/refinement.mjs) · [Evidence and assumptions](verification.md)

The SMT worker memoizes exact precondition, body and guarantee terms over fresh formal parameters within one query graph. Substitution instantiates these terms per call. The type encoding, flag symbols, frames and solver context are fixed for that worker. Baseline and candidate summaries are separate. A fresh invocation rechecks every linked function. Within a diff or gate the verifier holds proven groups in a private map and reuses matching groups from the baseline for the candidate. A group key includes the checked definition, reachable dependency keys, exact pins, type layouts, tool version and configuration. Source locations are restamped. The CLI accepts no proof cache or certificate from either revision.

## Reducer verification and execution

A checked reducer retains its two scalar-or-structured step parameters, state output, capacity, admission predicate, step, and exit guarantee. The frontend types the invariant in a state-only parameter scope. It constructs the exit guarantee by rebinding that same invariant to the result and conjoining the declared step guarantee. The capacity travels with the entry through linking, host declarations, artifact generation and comparison. A reducer remains an inductive host entry. The frontend lowers a reducer used as an expression to the same checked fold as an anonymous transition, with an explicit initial invariant guard and step calls.

Either proof engine can establish the transition obligation. The verifier records a derived prefix-invariant check from that premise. The runtime implements the induction base with an explicit initial check and the step with an ordered loop over snapshotted inputs and fixed grants. Solver counterexamples for a reducer transition replay as one-element host calls. The worker has no sequence-of-8,192 term to construct. The induction rule, its lowering and the emitted loop belong to the trusted base.

The wide integer model uses 32-bit bitvectors and explicit overflow predicates. Signed comparison follows two’s-complement order and signed arithmetic checks a sign-extended intermediate. JavaScript addition and subtraction of two u32 operands have exactly representable intermediate results. UUIDs map bijectively between canonical text and 128-bit bitvectors. Auto mode selects Z3 for domains containing text. Other domains use exact BigInt sizes, including hypothetical results in guarantee comparisons.

The worker represents text as a native sequence of 16-bit bitvectors. Larger collections use native sequences of the element sort, with type-specific length constraints on inputs and hypothetical results. Only active fields require bounds. For larger collections of bounded values the encoding quantifies over occupied indices. Capacities up to eight retain the tested datatype lowering. Native membership uses containment of a singleton. Direct sequence-returning folds can prove safety with a length invariant. General fold queries expand the step up to its capacity and can exhaust the query budget. Separate nominal types may share an SMT sequence sort. The frontend preserves nominality, and the worker applies bounds from each declared type.

Artifact validation executes a typed admission model as well as generic probes. Optional external vectors supply expected host outcomes, and the manifest binds their bytes by SHA-256. The interpreter and generated ESM share boundary primitives and run in Node. The independent policy implementation and hand-specified cases exercise those shared assumptions through the public interface.

## Collector verification and execution

The collector entry stores nominal input and output sequence layouts and the identity of a checked selector frame. Its direct edge goes through the ordinary linker. The selector is verified once over its element type and declared flags. The verifier then records static row admission and derives ordered emissions, the emitted-element guarantee and the output bound by induction. No solver query quantifies the outer batch.

The boundary validates the complete batch and snapshots grants before either execution path starts collecting. The interpreter evaluates the selector frame for each row. The emitter lowers the entry to a JS loop over the same boundary representation. The loop appends payloads in encounter order and stops on a failed selector frame. The exit boundary copies the completed array and its structured values.

The gate compares resolved selectors in their separate graphs and replays a differing row through both collector entries. The artifact worker also imports the exact emitted bytes and counts selector dispatch calls with V8 precise coverage. The independent mixed webhook vector checks the order and contents of the complete result. These tests exercise the traversal implementation that the proof rule assumes. [Verification rules](verification.md) · [Collector pilot](../pilot/collect/run.mjs)

## Contract abstraction and effect boundaries

For large finite domains in auto mode and finite-domain symbolic callers of an
inductively proved sequence fold, an ordinary safety query can use a proved
callee’s precondition and a fresh result restricted by its postcondition and
type bounds. Each call can choose a different allowed result even with equal
arguments. This overapproximates deterministic execution. Preconditions and
type bounds guard the assumptions. If that model permits an abstract
counterexample, the verifier retries with exact implementations. Timeouts
and invalid worker replies leave proofs open. Relational and independence
queries use the actual implementations.

Lookup composition is outside the expression IR. The compiler emits a service
descriptor with a resource identity, a closed planner, a closed continuation
and the union of their flag requirements. The runtime owns the token table
and performs lookup between the two pure stages. This choice keeps arbitrary
host execution outside both the symbolic model and the source call graph.
The artifact worker exercises keyed dispatch with a deterministic handler
including denial and malformed replies. The host’s authorization and the
handler’s resource use remain part of deployment policy.
