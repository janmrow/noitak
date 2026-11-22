# What the proof establishes

For every well-typed assignment of parameters and declared flags, evaluating the precondition must be safe. At least one assignment must pass it. For **every admitted assignment**, the body must compute a value without a fault and the postcondition must safely return true for that value. Authorization decisions made by the host are outside this obligation.

## Two ways to check one obligation

**Enumeration** is the default. Each byte contributes 256 choices, each boolean or flag contributes two, and a tagged type contributes the sum of its variant cardinalities. The verifier calculates the Cartesian product with BigInt before examining any case. A function above the configured case limit receives an unverified result. Within the limit, the first parameter varies fastest, followed by later parameters and sorted flags. Failure returns the first counterexample in that order.

**Symbolic verification** is opt-in for verify, build, diff and gate. A Python worker translates each checked expression to a Z3 term and a boolean indicating safe evaluation. Bytes are 8-bit bitvectors. Unsigned overflow and underflow have explicit guards. Booleans use the solver's Bool sort and enums use finite algebraic datatypes with scalar fields. A conditional selects the safety obligation of the chosen arm. Short-circuit operators and match have analogous guards. Let requires safe evaluation of its initializer even when the binding is unused.

The first query asks whether any assignment satisfies:

```text
¬safe(pre) ∨ (pre ∧ ¬(safe(body) ∧ safe(post) ∧ post))
```

Here post uses the computed result. A satisfying model is decoded and replayed through the JS boundary. An unreproducible model blocks the proof. After an unsatisfiable first query, a second query must find a model for safe(pre) ∧ pre. Only this pair of answers establishes the obligation. A successful symbolic report has no enumeration counts.

Each query has a 3-second timeout and the parent gives each worker 10 seconds including startup. Unknown, timeout, missing solver, worker failure or invalid response blocks a build. Wall-clock limits may produce different completion outcomes under load. The fixed solver seed does not guarantee an identical witness across solver versions. The default engine has no external solver or wall-clock timeout. Neither method bounds total resources across an entire module.

## Reading a report

Function verification report schema 2 records source SHA-256, module identity and version, tool version, proof method and configuration, per-function reads and the exact domain cardinality. Each function check identifies the obligation, source location, and outcome. Enumeration supplies examined and admitted counts. The symbolic engine records the Z3 version when available. Builds also hash the ESM and declaration bytes and publish the files together. Digests are unsigned.

| Status | Meaning |
| --- | --- |
| proven | The selected engine established the whole required obligation |
| violated | A fault or false postcondition was found, admission was empty, or a vector produced a different result |
| unverified | The selected analysis could not establish the result within its bounds or encountered a tool failure |
| tested | A supplied vector produced its expected tagged outcome |
| unsupported | A property such as the host's authorization decision is outside the model |

The trusted base includes the frontend, selected proof engine, JS evaluator, artifact generator, Node and delivery of the correct files. Symbolic proofs additionally trust the translation, Python, Z3 and the worker protocol. Cross-engine tests check agreement on selected programs. No proof establishes that a contract captures every product requirement.

## Comparing revisions

Diff report schema 3 includes both verification reports. The selected engine also compares eligible functions. Enumeration honors the case limit. Z3 comparison uses a separate counterexample query with the same time bounds as individual proofs. Names, positional parameter types, result type, reads and public enum definitions are part of the comparison. It ignores locations and formatting when comparing expressions.

For functions proven on both sides with matching signatures and reads, the following rules apply to **edited contracts**. Let A and B denote the old and candidate revisions respectively.

| Field | Required implication | Maximum comparison domain |
| --- | --- | --- |
| requires | Every input admitted by A remains admitted by B | inputs × flag assignments |
| ensures | On jointly admitted inputs, every possible result satisfying B also satisfies A | inputs × flag assignments × return values |

A predicate holds only when evaluation safely returns true. A hypothetical result can therefore expose a weakened guarantee even if neither implementation produces that result. Enumeration preflights the full domain against the limit before filtering on admission. A witness marks the change risky. A completed implication marks that field compatible. Budget exhaustion or mismatched interfaces leaves compatibility undetermined.

For an edited body, compare actual returns on **jointly admitted** calls. Admission changes are checked separately. A simultaneous body and contract edit can yield two different witnesses. The body witness includes the tagged outcomes of both calls. A postcondition witness includes a hypothetical return that satisfies the candidate predicate and fails the baseline predicate. The JSON finding identifies the witness kind. Skipped checks and budget refusals carry a reason.

For symbolic comparison both programs share the same input symbols, flags and compatible enum definitions. The solver searches for a lost admission, a newly permitted hypothetical result or unequal actual returns. A proof of each complete function is a prerequisite. An unsatisfiable query establishes the selected relation. Satisfying models are type-checked and replayed by the JS predicates or evaluator. An invalid model, disagreement, unknown answer or worker failure leaves the comparison undetermined. Functions with mismatched signatures or grants are outside the relational rule. A conflicting definition of a same-named enum prevents a shared symbolic encoding.

| Classification | Other policy rules |
| --- | --- |
| compatible | Added export or enum, removed grant |
| risky | Removed export, changed signature, removed or edited public enum |
| policy-violation | Changed module identity, added a required grant, or either revision lacks a required proof |
| undetermined | Changed proof coverage or comparison outside the supported rules |

Coverage compares obligation, status and exact domain size. Each finding stands independently. A new export with a grant therefore produces both an export finding and a policy violation. Only compatible findings pass the gate.


Gate publishes only if both revisions pass their own proofs and all findings are compatible. The candidate IR and source digest flow from the comparison to the build in the same process. The artifact manifest additionally identifies the exact review.json bytes. For a real change decision the caller selects a trusted baseline, toolchain and policy. The included CI job exercises five fixed experiment cases. A passing experiment job means even the expected refusals were reproduced.
