# Noitak 0.9.0 engineering assessment

Noitak 0.9 adds an ordered collector entry. The webhook pilot uses it to
transform up to 32 deliveries with up to 128 labels each into typed CI jobs.
Archived deliveries and pushes with an explicitly missing ref are skipped.
A main push, archived delivery, missing-ref push, urgent release push and
repeated main push return main, urgent release and main in that order.
The host authenticates deliveries and submits jobs.

The selector preserves repository identity and emits only for active
repositories with a nonempty branch. It forwards the dispatcher's typed job
and the dispatcher's proof covers the urgency bit. The boundary validates
the entire batch and snapshots flags before any row executes, so a malformed
tail fails at the boundary. A reached selector fault fails the entire call.
[Component](../pilot/events/collect.noi) · [Strict caller](../pilot/collect/service.mts) · [Application vectors](../pilot/collect/vectors.json)

## Proof and change control

The selector proof covers one typed row under every assignment to its
declared flags. Literal admission, compatible nominal element types,
transitive reads and sufficient output capacity are checked statically.
Induction starts with an empty accumulator. A skipped row leaves the
accumulator unchanged. An emitting row appends one value satisfying the
selector guarantee. After *k* visits the accumulator is exactly the ordered
emissions of those *k* rows and its length is at most *k*. Each derived check
records the selector proof and its static premises.

The traversal and induction rule are trusted compiler semantics. The
row proof depends on checked IR, Z3 translation and the pinned solver.
Finite enumeration can veto a definitive result on a small row domain.
Artifact validation exercises the deployed JavaScript and independently
checks whole-array expectations on supplied vectors. It does not establish
universal compiler equivalence. Application authorization and arbitrary
whole-output contracts are outside the proof.
[Proof rules](verification.md) · [Backend and boundary](architecture.md)
