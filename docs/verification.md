# Verification boundary

The proof enumerates the Cartesian product of parameter domains and declared flag values. Every byte contributes 256 choices and every boolean or flag contributes two. For each tuple the evaluator checks the precondition without faults. On every admitted tuple it checks normal termination without arithmetic faults and the postcondition. At least one tuple must be admitted. No sampling can satisfy this obligation.

A deterministic case budget applies to each complete function domain before enumeration. Oversized domains remain unverified. A failed or unverified obligation blocks a build. Verification concerns source-level values in a well-formed call. Host authorization decisions, external state, and the JS engine remain trusted.
