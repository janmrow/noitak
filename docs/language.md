# Noitak 0.4

A source file holds one module. Forms are parenthesized, whitespace separates atoms, and a semicolon starts a line comment. LF, CRLF and CR each end one line. Positions count UTF-16 code units from one. Declaration order inside a function is fixed.

```text
(module ID MAJOR.MINOR.PATCH
  (enum ID (TAG [SCALAR]) ...) ...
  (record ID (FIELD SCALAR-OR-ENUM) ...) ...
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

Strict operands evaluate left to right. Calls are acyclic. There are no loops, mutable storage or implicit conversions. The type rule for a conditional is Γ ⊢ c : bool, Γ ⊢ a : T, Γ ⊢ b : T ⇒ Γ ⊢ (if c a b) : T.

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

`(record ticket (stage stage) (revision byte))` declares a nominal, immutable product. Field names are distinct. Fields can have scalar or enum type. Enum declarations are resolved before records, independent of source order. Both use the same type namespace. A record cannot contain another record in 0.4.

`(make ticket (stage s) (revision n))` evaluates each initializer once, left to right. Supply every field exactly once in declaration order. `(get ticket_value revision)` projects a field. Equality compares every field recursively. The first declared field varies fastest during enumeration. Multiplying field cardinalities yields the exact domain size.

Generated TypeScript exposes `Record_ticket` with readonly fields. JavaScript callers supply own data properties. Validation copies required fields recursively and ignores extras. The host receives a fresh tree for each successful structured result, including separate copies for equal subvalues. Host mutation after return affects only that copy. Bytes still require runtime range checks.

## Contracted calls

`(call helper_name arg ...)` is legal in a function or helper body. Its target must be a previously declared helper in the same module. Arguments evaluate once from left to right, including unused arguments. The callee gets a fresh parameter environment and can read only its own declared grants from the original entry snapshot. Each caller must declare every read required by each direct callee, even in an unreachable branch. This rule propagates authority requirements through the whole call chain.

A call checks the callee precondition, computes the body, then checks the callee postcondition against that value. A false inner precondition is a caller fault, which invalidates a proof for an admitted public input. Checked arithmetic propagates to the outer execution phase. Contracts use ordinary expressions without calls so their meaning stays independent of helper implementations.

Each lowered body is limited to 16,384 IR nodes (arrays and leaves) and 192 nested IR edges, counting a helper's embedded contracts and body at each call site. The checker reports `E_LIMIT` before verification for excessive expansion. Source lists retain their separate depth limit of 128.

## Observable independence

Place `(independent internal ...)` between `reads` and `requires` to name one or more distinct parameters. For every valid pair of calls with equal unlisted arguments and equal flags, changing any or all listed parameters must preserve admission and the entire successful return value. A secret-dependent precondition can violate the obligation even when every admitted call returns a constant.

Type checking resolves the parameter names. Verification establishes the property and build requires that proof. The annotation may appear on a helper as well as an export. The property applies to the declared value domain. Timing, malformed host objects, descriptor traps, resource consumption and code that handles the returned data are outside its scope.
