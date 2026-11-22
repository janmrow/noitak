# Research roadmap

The 0.2 experiment covers three steps from the original roadmap.

1. Finite contract refinement checks admission and return guarantees across versions. The counter example under examples/refinement shows a weakened promise even with identical executable behavior.
2. Finite nominal types support nullary variants and scalar payloads. Exhaustive matching and exact cardinalities connect the frontend to both proof engines and the generated TypeScript interface.
3. An optional Z3 backend handles domains above the enumeration ceiling. The differential suite uses the finite evaluator as a reference and exercises successful proofs, faults and unsatisfiable admission.

Version 0.3 implements relational Z3 queries and a gate that builds the compared candidate. The delivery pilot runs one accepted revision and four blocked scenarios through that gate. Its review worksheet records a participant's decision, whether source inspection was needed and any missing evidence.

The next question is how much review work this saves in practice. Gather participant observations, then try one decision from an independently maintained TypeScript application. Use the first concrete obstacle to prioritize better reports, richer data or verified function calls.
