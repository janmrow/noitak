# Noitak 0.2

A source file holds one module. Forms are parenthesized, whitespace separates atoms, and a semicolon starts a line comment. Positions count UTF-16 code units from one. Declaration order inside a function is fixed.

```text
(module ID MAJOR.MINOR.PATCH
  (enum ID (TAG [SCALAR]) ...) ...
  (fn ID ((ID TYPE) ...) TYPE
    (reads ID ...)
    (requires EXPR)
    (ensures EXPR)
    EXPR) ...)
```

Every function is public. Names match `[a-z][a-z0-9_]*`. The value names true, false and result are reserved in declarations. Numbers and version components are unsigned decimal without redundant leading zeroes. The scalar types are byte (integers 0 through 255) and bool. Parameter order defines the positional host interface. Each function has its own variable environment. Duplicate declarations and local shadowing are errors.

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

## Host boundary

Call `api.functionName(flags, ...positionalArguments)` with an object and exact arity. Each required flag must be an own data property with a boolean value. Accessors and inherited grants fail the check, extra fields are ignored, and the evaluator reads a private snapshot. Use ordinary data objects. A host-supplied Proxy can run host code during descriptor lookup. A thrown descriptor trap yields a capability error. Host code controls its own JavaScript realm.

A byte argument must be an integer-valued JS number in range. Negative zero becomes zero. A bool must be a primitive boolean. Validation checks the arguments before the flags. Success returns `{ok:true,value}`. Failure returns `{ok:false,code,phase}`.

| Code | Phase | Cause |
| --- | --- | --- |
| ARGUMENT | boundary | Wrong argument count, range or primitive type |
| CAPABILITY | boundary | Invalid flag object or required property |
| PRECONDITION | requires | False admission predicate |
| ARITHMETIC | requires, body or ensures | Checked addition or subtraction outside the byte range |
| POSTCONDITION | ensures | False return predicate |

Lists nest up to 128 levels. A module must have at least one function. Functions cannot call each other. Parameter tuples, the flag object and the result union are boundary structures.

## Finite tagged types

A module may declare `(enum name (tag) (other byte) ...)` anywhere among its functions. Each distinct variant has zero or one scalar payload. Enum names are nominal and occupy a separate type namespace. All declarations generate public TypeScript aliases named Enum_name.

Construct a value with `(tag name tag)` or `(tag name other expr)`. For subject type T, `(match subject (tag expr) (other x expr) ...)` must cover each variant of T exactly once. A payload binder is local to its arm and follows the ordinary no-shadowing rule. Arm result types must agree. Evaluate the subject once and evaluate only the selected arm. Equality compares tag and payload within a single nominal type.

The domain size is the sum of the variant sizes. A nullary variant contributes one. Enumeration uses lexical tag order, then scalar payload order. At the JS boundary, values use a discriminated union such as `{tag:"pending"} | {tag:"received",value:number}`. Required fields must be own data properties. The boundary copies these fields, validates the payload and discards extra fields. See examples/delivery.noi for an acknowledgment that preserves an already recorded sequence number.
