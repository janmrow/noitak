# What the proof establishes

For every well-typed assignment of parameters and declared flags, evaluating the precondition must be safe. At least one assignment must pass it. For **every admitted assignment**, the body must compute a value without a fault and the postcondition must safely return true for that value. Authorization decisions made by the host are outside this obligation.

## Selecting evidence for an obligation

**Enumeration** is the default. Each byte contributes 256 choices, each boolean or flag contributes two, and a tagged type contributes the sum of its variant cardinalities. A record contributes the product of its field cardinalities. For domains without text the verifier calculates the Cartesian product with BigInt before examining any case. A text-containing input domain is labeled `symbolic-text` and requires symbolic reasoning. A function above the configured case limit receives an unverified result. Within the limit, the first parameter varies fastest, followed by later parameters and sorted flags. Failure returns the first counterexample in that order.

**Symbolic verification** is opt-in for verify, build, diff and gate. A Python worker translates each checked expression to a Z3 term and a boolean indicating safe evaluation. Bytes are 8-bit bitvectors. Unsigned overflow and underflow have explicit guards. Booleans use the solver's Bool sort and enums use algebraic datatypes with typed payloads. Records use single-constructor datatypes. A conditional selects the safety obligation of the chosen arm. Short-circuit operators and match have analogous guards. Let requires safe evaluation of its initializer even when the binding is unused.

The first query asks whether any assignment satisfies:

```text
¬safe(pre) ∨ (pre ∧ ¬(safe(body) ∧ safe(post) ∧ post))
```

Here post uses the computed result. A satisfying model is decoded and replayed through the JS boundary. An unreproducible model blocks the proof. After an unsatisfiable first query, a second query must find a model for safe(pre) ∧ pre. The worker must return that admitted input, and the reference execution must succeed on it before the proof is accepted. Small symbolic checks also record enumeration evidence under `crosscheck`.

Each query has a 3-second timeout and the parent gives each worker 10 seconds including startup. Unknown, timeout, missing solver, worker failure or invalid response blocks a build. Wall-clock limits may produce different completion outcomes under load. The fixed solver seed does not guarantee an identical witness across solver versions. The default engine has no external solver or wall-clock timeout. Neither method bounds total resources across an entire module.

## Composition and observable independence

Every helper is checked on its full signature. Proof of a callee alone cannot establish that a particular caller supplies admitted arguments. A reached strict call must safely evaluate all arguments, pass the callee precondition, evaluate its body safely and satisfy its guarantee. Arithmetic faults retain their enclosing phase. False nested admission produces `CALL_PRECONDITION`, distinct from the outer entry's legitimate rejection. Neither engine can exclude that case from a caller proof.

Each `independent` clause adds a required `observable-independence` check after ordinary safety. At fixed public arguments and flags, let R be the call with every protected argument replaced by its first typed domain value. For every input X, require admission(X) = admission(R) and, on admission, body(X) = body(R). Equality to the same reference implies pairwise equality for any two choices of protected data. The function safety proof establishes safe predicates and complete, checked execution on admission. Solver `safety` and `admission` fields on the independence check refer to its synthetic boolean obligation. A violation reports both calls and outcomes. [Self-composition research](https://www-sop.inria.fr/everest/Tamara.Rezk/publication/Barthe-DArgenio-Rezk.pdf)

In symbolic mode, when no protected parameter occurs as a value in the precondition, body or guarantee, the checker can discharge independence by `parameter-nonoccurrence`. Callees can observe only explicit arguments and fixed grants. The proof depends on lexical resolution and isolated call frames. A referenced parameter uses the ordinary relational obligation. Small enumerable domains retain the independent audit.

The observable here is an admission decision or the complete returned language value. Postcondition failures on admitted inputs already invalidate safety. Public inputs and flags are held fixed. This property covers implicit control flow and does not establish secrecy against timing, memory consumption, a hostile JavaScript realm, different public inputs correlated with secrets, or disclosure by the host. Requiring explicit transitive grants limits which supplied flags each helper can access. [Least privilege](https://www.cs.virginia.edu/~evans/cs551/saltzer/)

## Independent checks and disagreement

For a definitive symbolic answer, the CLI also enumerates the obligation whenever its domain is at most `min(--limit, 4096)`. For a postcondition refinement this domain includes hypothetical results. For independence it counts reference comparisons, one per input assignment. Agreement records the second method and verdict. A discrepancy records both pieces of evidence and returns `unverified` for a proof or `undetermined` for a relation, with reason `engine-disagreement`. Above the threshold the report records the skipped cross-check. A timeout, unsupported result or invalid worker reply stays unresolved.

The signed-order mutation test runs a separate compiler copy with one mistranslated operation. Under that mutation the worker incorrectly proves a byte property and incorrectly certifies a body comparison. Concrete admission replay or enumeration can veto the first proof. Independent enumeration vetoes the false body comparison. An independently calculated integer predicate identifies the 255 failing values. At larger domains, a wrong unsatisfiable answer can still pass if the encoding or solver is wrong. Witness replay only checks satisfying models. [Mutation experiment](../tests/symbolic/composition.test.mjs)

## Reading a report

On POSIX, build and gate claim the fresh destination with an exclusive directory creation after staging all files. The destination can briefly appear empty before the complete bundle is renamed into place. A competing creator that claims the name first keeps its directory. Consume the bundle after the command exits successfully. An interruption during publication can leave an empty reservation behind. Use a fresh destination to retry.

Function verification report schema 8 records source and dependency SHA-256 digests, module identity and version, tool version, proof method and configuration, per-function reads, the direct call graph and enumerated-domain cardinalities or the symbolic-text marker. Each function check identifies the obligation, source location, and outcome. Enumeration supplies examined and admitted counts. The symbolic engine records the Z3 version when available. Builds also hash the ESM and declaration bytes and publish the files together. Digests are unsigned.

| Status | Meaning |
| --- | --- |
| proven | The selected engine established the whole required obligation |
| violated | A fault or false postcondition was found, admission was empty, or a vector produced a different result |
| unverified | The selected analysis could not establish the result within its bounds or encountered a tool failure |
| tested | A supplied vector produced its expected tagged outcome |
| unsupported | A property such as the host's authorization decision is outside the model |

The trusted base includes the frontend, selected proof engine, JS evaluator, artifact generator, Node and delivery of the correct files. Symbolic proofs additionally trust the translation, Python, Z3 and the worker protocol. Cross-engine tests check agreement on selected programs. No proof establishes that a contract captures every product requirement.

## Comparing revisions

Diff report schema 9 includes both verification reports. The selected engine also compares eligible functions. Enumeration honors the case limit. Z3 comparison uses a separate counterexample query with the same time bounds as individual proofs. Names, positional parameter types, result type, reads and public enum and record definitions are part of the comparison. It ignores locations and formatting when comparing expressions.

For functions proven on both sides with matching signatures and reads, the following rules apply to **edited contracts**. Let A and B denote the old and candidate revisions respectively.

| Field | Required implication | Maximum comparison domain |
| --- | --- | --- |
| requires | Every input admitted by A remains admitted by B | inputs × flag assignments |
| ensures | On jointly admitted inputs, every possible result satisfying B also satisfies A | inputs × flag assignments × return values |

A predicate holds only when evaluation safely returns true. A hypothetical result can therefore expose a weakened guarantee even if neither implementation produces that result. Enumeration preflights the full domain against the limit before filtering on admission. A witness marks the change risky. A completed implication marks that field compatible. Budget exhaustion or mismatched interfaces leaves compatibility undetermined.

For an edited body, compare actual returns on **jointly admitted** calls. Admission changes are checked separately. A simultaneous body and contract edit can yield two different witnesses. The body witness includes the tagged outcomes of both calls. A postcondition witness includes a hypothetical return that satisfies the candidate predicate and fails the baseline predicate. The JSON finding identifies the witness kind. Skipped checks and budget refusals carry a reason.

For symbolic comparison both programs share the same input symbols, flags and compatible enum definitions. The solver searches for a lost admission, a newly permitted hypothetical result or unequal actual returns. A proof of each complete function is a prerequisite. An unsatisfiable query establishes the selected relation. Satisfying models are type-checked and replayed by the JS predicates or evaluator. An invalid model, disagreement, unknown answer or worker failure leaves the comparison undetermined. Functions with mismatched signatures or grants are outside the relational rule. A conflicting definition of a same-named type prevents a shared symbolic encoding.

| Classification | Other policy rules |
| --- | --- |
| compatible | Added export or public type, removed grant, strengthened independence |
| risky | Removed export, changed signature, removed or edited public type |
| policy-violation | Changed module identity, added or delegated a grant, weakened independence, or either revision lacks a required proof |
| undetermined | Changed proof coverage or comparison outside the supported rules |

Coverage compares obligation, status and domain descriptor. Interface and layout changes also produce their own findings. Each finding stands independently. A new export with a grant therefore produces both an export finding and a policy violation. Only compatible findings pass the gate.


The strict gate publishes only if both revisions pass their own proofs and all findings are compatible. A separately supplied authorization can approve a bounded class of witnessed changes under the conditions below. The candidate IR and source digest flow from the comparison to the build in the same process. The artifact manifest additionally identifies the exact review.json bytes. For a real change decision the caller selects a trusted baseline, toolchain and policy. CI exercises the delivery and support pilots and the installed TypeScript metering consumer. A passing experiment job means even the expected refusals were reproduced.

The body comparison applies to root and imported public functions, with private implementations taken from the reachable call graph. A private-only refactor may change the source digest without changing a public outcome. Adding a grant to a private helper is a policy violation, even when the caller already has it. A retained private helper with an independence guarantee must keep its positional parameter types and result type and must still protect every previously protected position. Parameter names may change. The finding shows the names, zero-based positions and types in both revisions. Removing independence from a public entry is also a policy violation. Removed exports and changes to exposed record definitions remain risky. A fresh proof of every required check on both revisions is mandatory for publication.

Consumers of schema 8 function reports should index checks by `(function, property)`. Multiple checks may describe one function, and private helper checks are included. A `passed` value covers the aggregate. CI consumers should also check the process exit status and use the new invocation's artifact digests.


## Bounded data and linked evidence

For element cardinality K and capacity C, sequence cardinality is the sum of K^i for i from zero through C. Enumeration visits increasing lengths, then varies the first element fastest. Through capacity eight Z3 uses a distinct datatype constructor for each legal length. Above eight it uses a native sequence with an explicit length bound and membership uses singleton containment. The gate classifies increased sequence capacity as a policy violation. Each fold iteration guards both its accumulator update and its safety condition by presence of the element. Inactive datatype selectors cannot contribute a value or a fault. An attempted call always requires safe index, arguments and admission; callee body and postcondition safety are required on admission.

A pin change records a dependency finding. Independent safety, authority, interface and relational findings determine whether the gate can accept the revision. The loader verifies the entire pin chain before a result can be published. The report includes even unused imported functions and their proofs. The root export's call edges identify its dependency path. All root and imported types enter the relational type-layout check. The CLI snapshots each revision separately and builds from the reviewed candidate graph. Pins and unsigned digests identify content; a consumer still supplies the trusted baseline and toolchain.

## Inductive proofs and evidence policy

For a reducer with state S, row X, fixed flags F, invariant I and step T, verify ordinary nonempty admission and the following universal step obligation:

```text
safe(I(S,F))
I(S,F) ⇒ safe(T(S,X,F)) ∧ I(T(S,X,F),F) ∧ stepGuarantee(S,X,T(S,X,F),F)
```

Both exit predicates must evaluate safely on an admitted step. Runtime admission supplies the base case. Induction on the number of rows processed establishes the invariant at every prefix of any well-typed admitted batch up to capacity. Empty input preserves the initial state. The one-transition domain counts states × rows × flags. It does not count input arrays. A failed or unresolved transition leaves the derived property unverified. A reported step witness uses `[state, row]`. Supply `[state, [row]]` as positional host arguments.

The comparison of two proven reducers with the same calling convention and capacity checks admission, the combined next-state and step promises, and observed one-step returns. Preservation of admission and equality of successive states establish equal final values on old admitted batches by induction. Capacity reduction is an interface risk. Increasing it expands the accepted per-call resource budget and is a policy violation. A change between reducer and ordinary entry also requires review.

The default enumerable proof budget and explicit symbolic engine remain available. With `--engine auto` each proof or comparison uses enumeration up to `--limit` and chooses Z3 above that threshold or for text-containing domains. This choice happens before the query. Solver uncertainty persists. Specifying `--engine enumerate` instead makes that limit a hard refusal for oversized domains. Symbolic comparisons and proofs keep their configured time limits.

Schema 7 separates static and runtime enforcement in `enforced`, required formal checks in `checks`, and unsupported claims in `outsideProof`. Vectors report tested cases through the test command. Every declared formal obligation is mandatory for build and gate, including induction and independence. Engine selection changes the evidence method. It cannot relax this acceptance policy.

An intentional revision to a public promise requires an authority outside the candidate. Review the blocked finding and witness against the changed requirement, then promote an independently approved baseline through the project's trusted release process. A future authorization format could bind the old and new digests, named relation and approving identity while continuing to require proofs of both revisions and all other relations. The CLI currently implements no exception or self-approval field.

## Testing the emitted artifact

The source verifier evaluates checked IR. Build and gate additionally load the exact generated ESM bytes into a short-lived Node worker and compare public calls with the reference interpreter. The worker checks the frozen public surface, tagged outcomes and values. Every successful bundle records its backend, module digest and differential results under `artifactValidation`. A gate also returns that evidence alongside the published path. A mismatch returns a diagnostic with arguments and outcomes. An import failure, worker failure or 30-second module comparison timeout refuses publication.

For each export the driver compares up to 64 evenly spaced mixed-radix positions, or 16 deterministic typed samples on text-containing domains. Samples include empty, maximum-length and non-ASCII text. Reducers also receive empty and repeated-element batches at the endpoints when capacity permits. Wrong arity and absent required grants have independent expected boundary errors. Enumeration retains its first admitted assignment. Z3 returns a concrete admission model. The driver executes that assignment through the emitted API, using a one-element batch for a reducer.

Each export reports total calls, successful returns, calls that reached a body (`admittedBodies` counts successful nonempty batches for reducers), typed sample count, admission-witness use and application-vector count. Zero admitted bodies yields `incomplete` and prevents publication. `tested` establishes agreement on the reported calls. It supplies no branch-coverage percentage or compiler-equivalence theorem.

`build` and `gate` accept `--vectors FILE` in the same nonempty JSON format as `test`. Every supplied expectation must match the emitted API and the interpreter. A disagreement, unknown export or malformed vector blocks publication. The report and approved review include the exact vector file digest. A trusted caller can pin and require its own vector file in CI. The module has no switch to relax this policy. Proofs remain mandatory even when all application cases pass.

Text proofs use sequences of 16-bit units with an upper bound of 1,024. Nested constraints apply to active payloads, fields and present sequence elements, including hypothetical returns. The symbolic translation, bound placement, nonoccurrence rule and both sequence representations belong to the trusted base. Replay can reject a bad model. Large-domain unsatisfiability still depends on the encoding and Z3. The artifact comparison additionally trusts the Node realm, shared boundary and equality code, and any external expected results selected by the caller.

## Collector proofs

The selector's explicit true admission covers every typed element and every
assignment to its declared flags. The ordinary safety obligation proves that
evaluation succeeds and satisfies the selector's postcondition. The checker
resolves the frame and checks that its result is a payload-free `skip` or an
`emit` of the output element type. The collector has all transitive reads, so
the selector proof applies under the invocation's fixed grant snapshot.

The trusted traversal rule maintains a prefix invariant. After visiting the
first *k* rows the accumulator holds exactly their emissions, in row order,
and has length at most *k*. The base case is the empty array. A skip leaves
the accumulator unchanged. An emit appends one typed value satisfying the
selector postcondition. Induction proves order, origin and the output bound.
When the selector proof is open or violated these derived obligations stay
open. The rule does not encode a hypothetical whole output into SMT. An
arbitrary whole-output predicate needs an exact analysis of its own.

The report names the selector proof and static premises of each derived
property. The solver checks the element domain, including each flag
assignment, and affordable domains retain the independent enumeration
cross-check. Counterexamples are replayed at the row boundary. Build-time
artifact validation separately tests that the emitted loop implements the
specified traversal on observed inputs.

A collector gate compares its entry convention, nominal input and output types,
capacities and reads. A capacity increase or added read violates policy. The
selector's postcondition is checked by refinement over hypothetical row
results. When both selectors are proven, contribution comparison uses
structural equality of `skip` or `emit(value)` under fixed grants. Equal
contributions and the shared traversal rule imply equal ordered outputs. A
different contribution replays as a one-row host batch on each revision.

For text-containing contribution domains the worker can first search a typed
subset with singleton native sequence fields. A model from that search must
pass the full JS boundary and replay on both revisions. If the subset yields
no model the full-domain query determines compatibility or leaves it open.

Collector artifact evidence records successful host calls, successful
nonempty calls, executed selector dispatches and emitted values. The worker
measures dispatches in the emitted module with V8 precise coverage and checks
the count against the visited rows on compared calls. Empty batches provide
admission evidence. A collector that always skips can have nonzero dispatch
coverage with zero emissions. Whole-array vectors can detect a change in
order that a one-row comparison cannot exercise.

## Proof assumptions and reuse in 0.10

Each verified function group reports stable obligation IDs, a checked
definition digest, and direct dependency digests. The report includes the
configuration and the proof session assumption digest. A diff or gate
operation can reuse successful results from its own baseline verification.
It invalidates reuse after changes to the checked definition or reachable
callee definitions, and conservatively after any linked type layout,
dependency pin or proof configuration change. Cache entries never cross a
CLI invocation. Candidate files and JSON evidence cannot feed the cache.

For symbolic safety on large finite domains in auto mode, a caller can use an already proved callee’s
contract as a premise. The callee postcondition is assumed only for typed
admitted arguments and all allowed outputs are considered. A potential
failure under that approximation triggers exact verification. Admission is
established separately and replayed through concrete execution. Failures in
verification or replay leave the obligation open. Source typing, runtime
enforcement, source proofs and tests of generated code remain distinct
evidence. For a direct reducer entry, termination follows the input bound
and finite acyclic step structure. Its inductive preservation proof is a
separate obligation. Composed reductions currently expand at their checked
sequence capacity, and proof cost may grow even when execution is bounded.

## Authorizing an intentional change

Run `noitak diff OLD NEW --engine auto --json` using the trusted baseline and
toolchain. A reviewer can supply a separate JSON file of the form

```json
{"schema":1,"scopeSha256":"DIGEST_FROM_AUTHORIZATION_SCOPE","allowBehavior":["assess"]}
```

Use the report’s `authorizationScopeSha256`. It covers both source
snapshots and their pins, the compiler version and the proof configuration.
Run `noitak gate OLD NEW NEW_DIR --engine auto --authorization POLICY`.
The protected caller chooses both the baseline and the authorization bytes.
In CI, use a protected workflow or equivalent job with an independently
reviewed toolchain and policy store. A path supplied by candidate-controlled
workflow code carries no independent authority. A changed snapshot or
configuration requires fresh authorization.

Authorization accepts exactly the named witnessed body differences. The
report retains those witnesses and records the authorization digest and
`authorized-evolution` decision. Contract weakening, lost independence,
expanded authority and unresolved obligations remain blocking findings.
The gate refuses changes to an existing lookup descriptor or planner IR,
including reachable planner code. This conservative policy covers observable
requests and can block equivalent planner refactors. A handler replacement
inside the host remains outside source review. Static work and depth changes
are reported. The existing hard work and capacity policies apply.

## Artifact execution and effect assurance

Artifact checking executes emitted ESM in a short-lived Node worker with an
empty environment, V8 heap and stack limits, and a wall-clock timeout. It
requires admitted executions and verifies a simulated host handler’s effects
for each lookup service, including resource mismatch, wrong key, forged
token and malformed reply. The worker shares process credentials and Node
APIs. It loads only compiler-emitted bytes in the normal build. The worker
offers isolation of JS state and limited resources, with filesystem and OS
isolation delegated to the execution environment. Solver subprocesses use
isolated Python mode and query and hard execution deadlines.

Capability token identity, exact namespace and key checks enforce the
authorization before the handler dispatch. The static proof reasons about
the pure continuation over all typed replies. It leaves host honesty,
availability, response truth and service trace independence unestablished.
The chosen scope and workload limits address controls described in
[MITRE CWE-862](https://cwe.mitre.org/data/definitions/862.html) and
[OWASP API4](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/).
