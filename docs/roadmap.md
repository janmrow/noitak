# Research roadmap

The 0.2 experiment covers three steps from the original roadmap.

1. Finite contract refinement checks admission and return guarantees across versions. The counter example under examples/refinement shows a weakened promise even with identical executable behavior.
2. Finite nominal types support nullary variants and scalar payloads. Exhaustive matching and exact cardinalities connect the frontend to both proof engines and the generated TypeScript interface.
3. An optional Z3 backend handles domains above the enumeration ceiling. The differential suite uses the finite evaluator as a reference and exercises successful proofs, faults and unsatisfiable admission.

The next question is how much review work these mechanisms actually save. A useful experiment would collect representative edits, record which changes yield a witness or proof, and identify the most common reason for an undetermined comparison. Those results can guide whether symbolic contract refinement or richer data types deserve priority.
