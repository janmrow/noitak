# What the proof establishes

For every well-typed assignment of parameters and declared flags, evaluating the precondition must be safe. At least one assignment must pass it. For **every admitted assignment**, the body must compute a value without a fault and the postcondition must safely return true for that value. Authorization decisions made by the host are outside this obligation.

## Two ways to check one obligation

**Enumeration** is the default. Each byte contributes 256 choices, each boolean or flag contributes two, and a tagged type contributes the sum of its variant cardinalities. A record contributes the product of its field cardinalities. The verifier calculates the Cartesian product with BigInt before examining any case. A function above the configured case limit receives an unverified result. Within the limit, the first parameter varies fastest, followed by later parameters and sorted flags. Failure returns the first counterexample in that order.

**Symbolic verification** is opt-in for verify, build, diff and gate. A Python worker translates each checked expression to a Z3 term and a boolean indicating safe evaluation. Bytes are 8-bit bitvectors. Unsigned overflow and underflow have explicit guards. Booleans use the solver's Bool sort and enums use finite algebraic datatypes with scalar fields. Records use single-constructor datatypes. A conditional selects the safety obligation of the chosen arm. Short-circuit operators and match have analogous guards. Let requires safe evaluation of its initializer even when the binding is unused.

The first query asks whether any assignment satisfies:

```text
¬safe(pre) ∨ (pre ∧ ¬(safe(body) ∧ safe(post) ∧ post))
```

Here post uses the computed result. A satisfying model is decoded and replayed through the JS boundary. An unreproducible model blocks the proof. After an unsatisfiable first query, a second query must find a model for safe(pre) ∧ pre. Only this pair of answers establishes the obligation. Small symbolic checks also record enumeration evidence under `crosscheck`.

Each query has a 3-second timeout and the parent gives each worker 10 seconds including startup. Unknown, timeout, missing solver, worker failure or invalid response blocks a build. Wall-clock limits may produce different completion outcomes under load. The fixed solver seed does not guarantee an identical witness across solver versions. The default engine has no external solver or wall-clock timeout. Neither method bounds total resources across an entire module.

## Composition and observable independence

Every helper is checked on its full signature. Proof of a callee alone cannot establish that a particular caller supplies admitted arguments. A reached strict call must safely evaluate all arguments, pass the callee precondition, evaluate its body safely and satisfy its guarantee. Arithmetic faults retain their enclosing phase. False nested admission produces `CALL_PRECONDITION`, distinct from the outer entry's legitimate rejection. Neither engine can exclude that case from a caller proof.

Each `independent` clause adds a required `observable-independence` check after ordinary safety. At fixed public arguments and flags, let R be the call with every protected argument replaced by its first typed domain value. For every input X, require admission(X) = admission(R) and, on admission, body(X) = body(R). Equality to the same reference implies pairwise equality for any two choices of protected data. The function safety proof establishes safe predicates and complete, checked execution on admission. Solver `safety` and `admission` fields on the independence check refer to its synthetic boolean obligation. A violation reports both calls and outcomes. [Self-composition research](https://www-sop.inria.fr/everest/Tamara.Rezk/publication/Barthe-DArgenio-Rezk.pdf)

The observable here is an admission decision or the complete returned language value. Postcondition failures on admitted inputs already invalidate safety. Public inputs and flags are held fixed. This property covers implicit control flow and does not establish secrecy against timing, memory consumption, a hostile JavaScript realm, different public inputs correlated with secrets, or disclosure by the host. Requiring explicit transitive grants limits which supplied flags each helper can access. [Least privilege](https://www.cs.virginia.edu/~evans/cs551/saltzer/)

## Independent checks and disagreement

For a definitive symbolic answer, the CLI also enumerates the obligation whenever its domain is at most `min(--limit, 4096)`. For a postcondition refinement this domain includes hypothetical results. For independence it counts reference comparisons, one per input assignment. Agreement records the second method and verdict. A discrepancy records both pieces of evidence and returns `unverified` for a proof or `undetermined` for a relation, with reason `engine-disagreement`. Above the threshold the report records the skipped cross-check. A timeout, unsupported result or invalid worker reply stays unresolved.

The signed-order mutation test runs a separate compiler copy with one mistranslated operation. Under that mutation the worker incorrectly proves a byte property and incorrectly certifies a body comparison. The actual build and gate both refuse publication when enumeration disagrees. An independently calculated integer predicate identifies the 255 failing values. At larger domains, a wrong unsatisfiable answer can still pass if the encoding or solver is wrong. Witness replay only checks satisfying models. [Mutation experiment](../tests/symbolic/composition.test.mjs)

## Reading a report

On POSIX, build and gate claim the fresh destination with an exclusive directory creation after staging all files. The destination can briefly appear empty before the complete bundle is renamed into place. A competing creator that claims the name first keeps its directory. Consume the bundle after the command exits successfully. An interruption during publication can leave an empty reservation behind. Use a fresh destination to retry.

Function verification report schema 4 records source and dependency SHA-256 digests, module identity and version, tool version, proof method and configuration, per-function reads, the direct call graph and exact domain cardinalities. Each function check identifies the obligation, source location, and outcome. Enumeration supplies examined and admitted counts. The symbolic engine records the Z3 version when available. Builds also hash the ESM and declaration bytes and publish the files together. Digests are unsigned.

| Status | Meaning |
| --- | --- |
| proven | The selected engine established the whole required obligation |
| violated | A fault or false postcondition was found, admission was empty, or a vector produced a different result |
| unverified | The selected analysis could not establish the result within its bounds or encountered a tool failure |
| tested | A supplied vector produced its expected tagged outcome |
| unsupported | A property such as the host's authorization decision is outside the model |

The trusted base includes the frontend, selected proof engine, JS evaluator, artifact generator, Node and delivery of the correct files. Symbolic proofs additionally trust the translation, Python, Z3 and the worker protocol. Cross-engine tests check agreement on selected programs. No proof establishes that a contract captures every product requirement.

## Comparing revisions

Diff report schema 5 includes both verification reports. The selected engine also compares eligible functions. Enumeration honors the case limit. Z3 comparison uses a separate counterexample query with the same time bounds as individual proofs. Names, positional parameter types, result type, reads and public enum and record definitions are part of the comparison. It ignores locations and formatting when comparing expressions.

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

Coverage compares obligation, status and exact domain size. Each finding stands independently. A new export with a grant therefore produces both an export finding and a policy violation. Only compatible findings pass the gate.


Gate publishes only if both revisions pass their own proofs and all findings are compatible. The candidate IR and source digest flow from the comparison to the build in the same process. The artifact manifest additionally identifies the exact review.json bytes. For a real change decision the caller selects a trusted baseline, toolchain and policy. The CI job exercises all three TypeScript pilots. A passing experiment job means even the expected refusals were reproduced.

The body comparison applies to root and imported public functions, with private implementations taken from the reachable call graph. A private-only refactor may change the source digest without changing a public outcome. Adding a grant to a private helper is a policy violation, even when the caller already has it. Removing an independence guarantee from a retained helper or public entry requires review. Removed exports and changes to exposed record definitions remain risky. A fresh proof of every required check on both revisions is mandatory for publication.

Consumers of schema 4 function reports should index checks by `(function, property)`. Multiple checks may describe one function, and private helper checks are included. A `passed` value covers the aggregate. CI consumers should also check the process exit status and use the new invocation's artifact digests.


## Bounded data and linked evidence

For element cardinality K and capacity C, sequence cardinality is the sum of K^i for i from zero through C. Enumeration visits increasing lengths, then varies the first element fastest. Z3 uses a distinct datatype constructor for each legal length. Each fold iteration guards both its accumulator update and its safety condition by presence of the element. Inactive datatype selectors cannot contribute a value or a fault. An attempted call always requires safe index, arguments and admission; callee body and postcondition safety are required on admission.

A pin change records a dependency finding. Independent safety, authority, interface and relational findings determine whether the gate can accept the revision. The loader verifies the entire pin chain before a result can be published. The report includes even unused imported functions and their proofs. The root export's call edges identify its dependency path. All root and imported types enter the relational type-layout check. The CLI snapshots each revision separately and builds from the reviewed candidate graph. Pins and unsigned digests identify content; a consumer still supplies the trusted baseline and toolchain.
