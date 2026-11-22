# Verification boundary

The proof enumerates the Cartesian product of parameter domains and declared flag values. Every byte contributes 256 choices and every boolean or flag contributes two. For each tuple the evaluator checks the precondition without faults. On every admitted tuple it checks normal termination without arithmetic faults and the postcondition. At least one tuple must be admitted. No sampling can satisfy this obligation.

A deterministic case budget applies to each complete function domain before enumeration. Oversized domains remain unverified. A failed or unverified obligation blocks a build. Verification concerns source-level values in a well-formed call. Host authorization decisions, external state, and the JS engine remain trusted.

## Reading a report

Schema 1 records the module name and declared version, SHA-256 of the original source bytes, tool version, enumeration method, numeric limit, and sorted read names for each function. A check records its function location, obligation, exact domain size as a decimal string, examined tuple count, admission count and status. Enumeration starts at zero or false and advances the first parameter fastest, then later parameters, then sorted flag names. A counterexample includes positional arguments, flag values and the first failing phase. Replaying it requires the same source. JSON vectors can assert its complete tagged result.

| Status | Evidence |
| --- | --- |
| proven | Every tuple visited, precondition total, at least one admitted, body and postcondition safe on every admitted tuple |
| violated | A required property failed, an admission set was empty, or an explicit test produced another outcome |
| unverified | The full domain exceeds the configured limit. No tuples attempted |
| tested | One specified input produced its expected outcome in the vector runner |
| unsupported | The report explicitly excludes host authorization from its proof model |

Unsupported syntax is a frontend error. Unexpected tool failures abort the command. The case limit measures domain size, with no wall-clock timeout and no external solver. Large files, many functions or expensive expressions can still consume host resources. The vector runner executes statically accepted sources including ones that cannot be built. Its evidence is local to each vector.

Build adds independent SHA-256 digests of the executable and TypeScript declarations to the verification report. It stages all three files beside the destination and publishes the directory by rename. Consumers can recompute digests to check byte identity. The report is unsigned. The trusted base includes the frontend, domain generator, evaluator, artifact generator, Node engine and host delivery of the matching artifact. Tests exercise their agreement, including a separate arithmetic oracle on the emitted quota module. Contracts themselves express the author's assumptions and can omit an important requirement.

## Change policy

Diff verifies both inputs with the same limit. It compares typed declarations and parsed expressions with comments, locations and whitespace removed. It compares parameter names and order conservatively. Module version labels and source hashes identify both inputs. A version bump alone needs no review under this policy.

| Classification | Rule |
| --- | --- |
| compatible | Added export, removed flag requirement, or identical outcomes on every tuple of a comparable changed body |
| risky | Removed export, changed parameter list or return type, or an observed behavioral difference |
| policy-violation | Module identity changed, a function acquired a named grant, or a candidate function lacks a required proof |
| undetermined | Edited contract, changed proof coverage, or a body change outside the relational comparison rule |

For a changed body with identical interface, reads and contracts, and proofs on both sides, the tool enumerates the shared domain and compares the complete result of each call. A difference includes a witness in JSON. Equivalent outcomes are scoped to this function and domain. If the contract expression itself changes, the tool requests review even if both versions pass. It makes no implication claim between the predicates. Coverage compares obligation identifier, proof status and full domain size. Multiple findings can apply to one function. A newly added function with a grant also triggers the grant policy. An unchanged structural report or a passing gate addresses only the implemented rules.
