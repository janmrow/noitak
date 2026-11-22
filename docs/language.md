# Noi 0.1

A source file holds one module. Forms are parenthesized, whitespace separates atoms, and a semicolon starts a line comment. Positions count UTF-16 code units from one. Declaration order inside a function is fixed.

```text
(module ID MAJOR.MINOR.PATCH
  (fn ID ((ID TYPE) ...) TYPE
    (reads ID ...)
    (requires EXPR)
    (ensures EXPR)
    EXPR) ...)
```

Every function is public. Names match `[a-z][a-z0-9_]*`. The value names true, false and result are reserved in declarations. Numbers and version components are unsigned decimal without redundant leading zeroes. Types are byte (integers 0 through 255) and bool. Parameter order defines the positional host interface. Each function has its own variable environment. Duplicate declarations and local shadowing are errors.

| Expression | Typing and evaluation |
| --- | --- |
| literal or variable | Bytes, booleans and immutable lexical bindings |
| `(let x e body)` | Evaluate e once, bind its type and value in body |
| `(if c a b)` | c is bool, arms have equal types, evaluate only the selected arm |
| `(+ a b)`, `(- a b)` | Byte operands, checked byte result. Out-of-range arithmetic faults |
| `(< a b)`, `(<= a b)` | Byte operands, bool result |
| `(= a b)` | Equal operand types, exact value equality |
| `(not a)`, `(and a b)`, `(or a b)` | Bool operands and result, short-circuit binary operators |
| `(flag name)` | Bool from the declared named read capability |

Strict operands evaluate left to right. There are no loops, function calls, recursion, mutable storage or implicit conversions. The type rule for a conditional is Γ ⊢ c : bool, Γ ⊢ a : T, Γ ⊢ b : T ⇒ Γ ⊢ (if c a b) : T.

Each call receives arguments and a snapshot of the authorized boolean flags. Both contracts must type as bool. The precondition sees parameters and flags. The postcondition also sees the normal return value as `result`. A false precondition rejects the call. A fault in a contract is a failure. After an admitted call the body must return normally and its postcondition must hold. The public result is a tagged union carrying either a value or an error code. See the generated declarations for the boundary types.

Every declared flag is required at entry, including unused declarations. The only effect is reading these supplied values. No operation opens a file, invokes a callback or changes the host. Application code decides how to obtain and authorize flag values.
