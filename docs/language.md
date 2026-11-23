# Noitak 0.5

A source file holds one module. Forms are parenthesized, whitespace separates atoms, and a semicolon starts a line comment. LF, CRLF and CR each end one line. Positions count UTF-16 code units from one. Declaration order inside a function is fixed.

```text
(module ID MAJOR.MINOR.PATCH
  (import MODULE SHA256) ...
  (enum ID (TAG [SCALAR]) ...) ...
  (record ID (FIELD SCALAR-OR-ENUM) ...) ...
  (sequence ID ELEMENT CAPACITY) ...
  (outcome ID SUCCESS-TYPE) ...
  (fn|helper ID ((ID TYPE) ...) TYPE
    (reads ID ...)
    [(independent PARAM ...)]
    (requires EXPR)
    (ensures EXPR)
    EXPR) ...)
```

The `fn` declaration exports a host entry point. A `helper` is private to the module. Names match `[a-z][a-z0-9_]*`. The value names true, false and result are reserved in declarations. Numbers and version components are unsigned decimal without redundant leading zeroes. The scalar types are byte (integers 0 through 255) and bool. Parameter order defines the positional host interface. Each function has its own variable environment. Duplicate declarations and local shadowing are errors.

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

Strict operands evaluate left to right. Calls are acyclic. Repetition uses bounded folds. Bindings are immutable and all conversions are explicit. The type rule for a conditional is Γ ⊢ c : bool, Γ ⊢ a : T, Γ ⊢ b : T ⇒ Γ ⊢ (if c a b) : T.

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
| CALL_PRECONDITION, CALL_POSTCONDITION | body | A reached private call rejects its arguments or its result |

Lists nest up to 128 levels. A module must have at least one public function. Parameter tuples, the flag object and the result union are boundary structures.

## Finite tagged types

A module may declare `(enum name (tag) (other byte) ...)` anywhere among its functions. Each distinct variant has zero or one scalar payload. Enum names are nominal and occupy a separate type namespace. All declarations generate public TypeScript aliases named Enum_name.

Construct a value with `(tag name tag)` or `(tag name other expr)`. For subject type T, `(match subject (tag expr) (other x expr) ...)` must cover each variant of T exactly once. A payload binder is local to its arm and follows the ordinary no-shadowing rule. Arm result types must agree. Evaluate the subject once and evaluate only the selected arm. Equality compares tag and payload within a single nominal type.

The domain size is the sum of the variant sizes. A nullary variant contributes one. Enumeration uses lexical tag order, then scalar payload order. At the JS boundary, values use a discriminated union such as `{tag:"pending"} | {tag:"received",value:number}`. Required fields must be own data properties. The boundary copies these fields, validates the payload and discards extra fields. See examples/delivery.noi for an acknowledgment that preserves an already recorded sequence number.

## Records

`(record ticket (stage stage) (revision byte))` declares a nominal, immutable product. Field names are distinct. Fields can have scalar or enum type. Enum declarations are resolved before records, independent of source order. Both use the same type namespace. Fields can contain ordinary enums with scalar payloads.

`(make ticket (stage s) (revision n))` evaluates each initializer once, left to right. Supply every field exactly once in declaration order. `(get ticket_value revision)` projects a field. Equality compares every field recursively. The first declared field varies fastest during enumeration. Multiplying field cardinalities yields the exact domain size.

Generated TypeScript exposes `Record_ticket` with readonly fields. JavaScript callers supply own data properties. Validation copies required fields recursively and ignores extras. The host receives a fresh tree for each successful structured result, including separate copies for equal subvalues. Host mutation after return affects only that copy. Bytes still require runtime range checks.

## Contracted calls

`(call helper_name arg ...)` is legal in a function or helper body. Its target must be a previously declared local helper or a directly imported public function. Arguments evaluate once from left to right, including unused arguments. The callee gets a fresh parameter environment and can read only its own declared grants from the original entry snapshot. Each caller must declare every read required by each direct callee, even in an unreachable branch. This rule propagates authority requirements through the whole call chain.

A call checks the callee precondition, computes the body, then checks the callee postcondition against that value. A false inner precondition is a caller fault, which invalidates a proof for an admitted public input. Checked arithmetic propagates to the outer execution phase. Contracts use ordinary expressions without calls so their meaning stays independent of helper implementations.

The checker budgets up to 16,384 expression evaluations and 192 levels of expression depth per function, including contracts. Each call charges the callee cost, and each fold charges its step at the maximum length. All branches are counted conservatively. Excessive cost produces `E_LIMIT` before verification. This bounds expression steps, while structural operations on values also depend on value size. Source lists retain their separate depth limit of 128.

## Observable independence

Place `(independent internal ...)` between `reads` and `requires` to name one or more distinct parameters. For every valid pair of calls with equal unlisted arguments and equal flags, changing any or all listed parameters must preserve admission and the entire successful return value. A secret-dependent precondition can violate the obligation even when every admitted call returns a constant.

Type checking resolves the parameter names. Verification establishes the property and build requires that proof. The annotation may appear on a helper as well as an export. The property applies to the declared value domain. Timing, malformed host objects, descriptor traps, resource consumption and code that handles the returned data are outside its scope.

## Pinned sibling modules (0.5)

`(import ledger SHA256)` names a sibling file `ledger.noi`. The pin is the lowercase SHA-256 of its exact UTF-8 source bytes. Its module declaration must name `ledger`. Imported types and public functions are qualified, for example `ledger.ticket` and `(call ledger.transition prior event)`. Local declarations keep their ordinary names. Transitive dependencies must be pinned by their direct importer. Each module identity resolves to one snapshot per revision. The entry API exports only its own functions.

Each source revision loads at most 64 regular source files of up to 1 MiB each. Import names follow identifier syntax and imported files cannot be symbolic links. The verifier rechecks the linked dependencies. Each artifact records the root digest, dependency digests and call edges. The change gate compares imported public contracts and behavior as well as the root's observable results.

## Bounded sequences and recoverable admission (0.5)

`(sequence events action 3)` declares immutable ordered values of length zero through three. Capacities are integer literals 1 through 8. Elements may be bytes, booleans, ordinary enums or records. `(items events a b)` constructs a sequence and `(length xs)` returns a byte. Equality compares length, order and every element. JavaScript supplies dense arrays of own typed data properties. The boundary checks capacity before copying elements. TypeScript exposes `ReadonlyArray` and runtime enforces its length.

`(fold xs initial (acc item index) expression)` evaluates the sequence and initial value once, then evaluates the expression from left to right for each present element. The accumulator and step have the same type. Indices are zero-based bytes. An empty sequence returns the initial value. The maximum step count is the declared capacity. Folds may appear in contracts. Function calls remain restricted to bodies.

`(outcome answer state)` declares a nominal tagged value with alternatives `committed state` and `rejected byte`. `(attempt answer index target arg ...)` evaluates the index, arguments and target precondition in order. False admission returns `rejected index`. On admission, it executes the callee and checks its guarantee, returning `committed value`. Arithmetic faults and failed guarantees invalidate the caller's proof. A fold can retain its first rejection in subsequent iterations and return only the index, which gives the host a value it can use for an all-or-nothing update.
