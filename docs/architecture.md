# Implementation

## From source to a checked program

The CLI decodes UTF-8 strictly and retains original bytes for hashing. The parser builds located atoms and lists. The frontend first collects enums, then resolves records against the scalar and enum namespace. It checks functions in source order, with a separate environment of previously checked private helpers. Lexical scopes and capability names use maps. The resulting expression tree contains literals, variable names and fixed operator tuples. [Parser](../src/parser.mjs) · [Frontend](../src/frontend.mjs)

A checked call frame contains the helper name, formal names, argument expressions, precondition, body and postcondition. Its parameters have their own scope. The frontend can share checked subtrees in memory. Serialization expands each occurrence. This representation lets both engines check the actual implementation at the call site and lets a revision comparison see an edit several helpers below an unchanged caller. A bounded traversal stops exponential expansion before serialization. The size and depth limits are per body. Module size and total verification work remain operational limits. [Execution rules](language.md)

Each helper must prove its contract over its own declared domain, including when it has no callers. Each caller must also prove that reached calls satisfy that helper's admission predicate. Calls cannot occur in contract expressions. This keeps a helper edit from implicitly rewriting the requirement against which the caller is measured.

## Execution and boundaries

The evaluator implements strict call frames, checked arithmetic, structural value equality and lazy selected branches. Host entry validates positional arguments and snapshots named grants once. Record and tagged fields must be own data properties. The exit boundary materializes a fresh result tree. This last copy matters for independence: two equal fields must have the same observable value semantics even if the computation reused a single object in one branch. A host cannot distinguish those branches by comparing returned field identities. [Runtime](../src/runtime.mjs)

The backend embeds the evaluator and serializes checked public entry points into a standalone ESM. The only export is a frozen, null-prototype API object. Private helper implementations can be inspected in the artifact and invoked only through compiled calls in its public API. The build also emits structural TypeScript declarations and artifact digests. None of the generated expressions is evaluated as JavaScript source. [Artifact builder](../src/backend.mjs)

## Verification and review

The finite engine enumerates products in mixed radix using exact integer cardinalities. It uses the runtime evaluator. The symbolic engine translates the same checked trees to Z3 data values plus safety predicates. Records become single-constructor algebraic datatypes. Helper arguments, admission, execution and the guarantee each contribute a safety condition when the call is evaluated. A conditional or match guards the safety of the selected branch. Worker models pass through the JS boundary before they become reported witnesses. [Domain](../src/domain.mjs) · [Verifier](../src/verify.mjs) · [Worker](../src/symbolic_worker.py)

Independence has two implementations. Enumeration compares the complete outcomes of concrete calls against reference calls with fixed protected arguments. Symbolic checking constructs a second evaluation in a fresh lexical frame, proves equal admission and compares values on admission. On small domains a separate enumeration checks definitive solver verdicts and can veto them. The two engines share source resolution and checked IR. A separately written transition table exercises the public artifact to cover part of that shared trust boundary. [Independence](../src/independence.mjs) · [Cross-check](../src/crosscheck.mjs) · [Artifact oracle](../tests/composition.test.mjs)

The gate verifies both source snapshots, analyzes their policy and semantics, then builds the in-memory candidate already tied to the review. Public body comparison includes expanded helper definitions. Contract refinement still compares hypothetical results independently of either body's observed return. The CLI is the supported verification and publication boundary. Internal JavaScript compiler functions accept trusted IR and reports. [Change comparison](../src/diff.mjs) · [Refinement](../src/refinement.mjs) · [Evidence and assumptions](verification.md)
