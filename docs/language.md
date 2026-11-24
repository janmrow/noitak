# Noitak 0.10

A source file holds one module. Forms are parenthesized, whitespace separates atoms, and a semicolon outside a quoted literal starts a line comment. LF, CRLF and CR each end one line. Positions count UTF-16 code units from one. Declaration order inside a function is fixed.

```text
(module ID MAJOR.MINOR.PATCH
  (import MODULE SHA256) ...
  (enum ID (TAG [TYPE]) ...) ...
  (record ID (FIELD TYPE) ...) ...
  (sequence ID ELEMENT CAPACITY [u32]) ...
  (outcome ID SUCCESS-TYPE) ...
  (reducer ID ((STATE S) (ITEM E)) S (reads ID ...) (capacity N)
    (invariant EXPR) (ensures EXPR) STEP) ...
  (fn|helper ID ((ID TYPE) ...) TYPE
    (reads ID ...)
    [(independent PARAM ...)]
    (requires EXPR)
    (ensures EXPR)
    EXPR) ...
  (lookup SERVICE RESOURCE PLANNER RESUME) ...)
```

The `fn` declaration exports a host entry point. A `helper` is private to the module. Names match `[a-z][a-z0-9_]*`. The value names true, false and result are reserved in declarations. Numbers and version components are unsigned decimal without redundant leading zeroes. Scalar types are byte (0 through 255), u32 (0 through 4,294,967,295), i32 (−2,147,483,648 through 2,147,483,647), bool, uuid and text. Parameter order defines the positional host interface. Each function has its own variable environment. Duplicate declarations and local shadowing are errors.

| Expression | Typing and evaluation |
| --- | --- |
| literal or variable | Byte, u32, i32, text and boolean literals, or immutable lexical bindings |
| `(let x e body)` | Evaluate e once, bind its type and value in body |
| `(if c a b)` | c is bool, arms have equal types, evaluate only the selected arm |
| `(+ a b)`, `(- a b)` | Equal integer operand types, checked result of the same type. Out-of-range arithmetic faults |
| `(< a b)`, `(<= a b)` | Equal integer operand types, signed comparison for i32, bool result |
| `(widen a)` | Convert a byte to u32 exactly |
| `(uuid 00112233-4455-6677-8899-aabbccddeeff)` | Canonical 128-bit identifier literal |
| `(= a b)` | Equal operand types, exact value equality |
| `(not a)`, `(and a b)`, `(or a b)` | Bool operands and result, short-circuit binary operators |
| `(flag name)` | Bool from the declared named read capability |

Strict operands evaluate left to right. Calls are acyclic. Repetition uses typed folds and named reducers. Bindings are immutable and all conversions are explicit. The type rule for a conditional is Γ ⊢ c : bool, Γ ⊢ a : T, Γ ⊢ b : T ⇒ Γ ⊢ (if c a b) : T.

Each call receives arguments and a snapshot of the authorized boolean flags. Both contracts must type as bool. The precondition sees parameters and flags. The postcondition also sees the normal return value as `result`. A false precondition rejects the call. A fault in a contract is a failure. After an admitted call the body must return normally and its postcondition must hold. The public result is a tagged union carrying either a value or an error code. See the generated declarations for the boundary types.

Every declared flag is required at entry, including unused declarations. Ordinary functions and reducers read only the supplied snapshot. A lookup service can compose two ordinary functions with a separately granted host operation.

## Host boundary

Call `api.functionName(flags, ...positionalArguments)` with an object and exact arity. Each required flag must be an own data property with a boolean value. Accessors and inherited grants fail the check, extra fields are ignored, and the evaluator reads a private snapshot. Use ordinary data objects. A host-supplied Proxy can run host code during descriptor lookup. A thrown descriptor trap yields a capability error. Host code controls its own JavaScript realm.

A byte argument must be an integer-valued JS number in range. Negative zero becomes zero. A bool must be a primitive boolean. Validation checks the arguments before the flags. Success returns `{ok:true,value}`. Failure returns `{ok:false,code,phase}`.

| Code | Phase | Cause |
| --- | --- | --- |
| ARGUMENT | boundary | Wrong argument count, range or primitive type |
| CAPABILITY | boundary | Invalid flag object or required property |
| PRECONDITION | requires | False admission predicate |
| ARITHMETIC | requires, body or ensures | Checked addition or subtraction outside the operand type range |
| CAPACITY | requires, body or ensures | Append to a full sequence |
| POSTCONDITION | ensures | False return predicate |
| CALL_PRECONDITION, CALL_POSTCONDITION | body | A reached private call rejects its arguments or its result |

Lists nest up to 128 levels. A module must have at least one public function. Parameter tuples, the flag object and the result union are boundary structures.

## Finite tagged types

A module may declare `(enum name (tag) (other byte) ...)` anywhere among its functions. Each distinct variant has zero or one typed payload. Enum names are nominal and occupy a separate type namespace. All declarations generate public TypeScript aliases named Enum_name.

Construct a value with `(tag name tag)` or `(tag name other expr)`. For subject type T, `(match subject (tag expr) (other x expr) ...)` must cover each variant of T exactly once. A payload binder is local to its arm and follows the ordinary no-shadowing rule. Arm result types must agree. Evaluate the subject once and evaluate only the selected arm. Equality compares tag and payload within a single nominal type.

The domain size is the sum of the variant sizes. A nullary variant contributes one. Enumeration uses lexical tag order, then payload order on enumerated domains. At the JS boundary, values use a discriminated union such as `{tag:"pending"} | {tag:"received",value:number}`. Required fields must be own data properties. The boundary copies these fields, validates the payload and discards extra fields. See examples/delivery.noi for an acknowledgment that preserves an already recorded sequence number.

## Records

`(record ticket (stage stage) (revision byte))` declares a nominal, immutable product. Field names are distinct. Fields, payloads, sequence elements and outcome successes can use any resolved type, including a directly imported qualified type. Forward type references are legal. All nominal types share a namespace. The compiler rejects cycles, nesting deeper than 32 declarations and expanded layout cost above 16,384 per type. This bounds duplication through repeated children and the selectors needed by the symbolic encoding. Function call order retains its separate earlier-helper rule.

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

`(sequence events action 3)` declares immutable ordered values of length zero through three. Capacities are integer literals from 1 through 255 by default. `(sequence events action 512 u32)` opts into a u32 length and index. This form accepts capacities through 65,535 subject to the compiler’s lower expanded-layout and work budgets. `(items events a b)` constructs a sequence and `(length xs)` returns the declared index type. Equality compares length, order and every element. JavaScript supplies dense arrays of own typed data properties. The boundary checks capacity before copying elements. TypeScript exposes `ReadonlyArray` and runtime enforces its length. `(member xs item)` evaluates both operands once in order, including the item for an empty sequence. It returns a boolean using structural equality. Its static work estimate charges the declared capacity.

`(fold xs initial (acc item index) expression)` evaluates the sequence and initial value once, then evaluates the expression from left to right for each present element. The accumulator and step have the same type. Indices are zero-based and have the declared index type. An empty sequence returns the initial value. The maximum step count is the declared capacity. Folds may appear in contracts. Function calls remain restricted to bodies.

`(outcome answer state)` declares a nominal tagged value with alternatives `committed state` and `rejected byte`. `(attempt answer index target arg ...)` evaluates the index, arguments and target precondition in order. False admission returns `rejected index`. On admission, it executes the callee and checks its guarantee, returning `committed value`. Arithmetic faults and failed guarantees invalidate the caller's proof. A fold can retain its first rejection in subsequent iterations and return only the index, which gives the host a value it can use for an all-or-nothing update.

## Wide quantities and identifiers

A bare decimal literal has type byte. A decimal literal ending in `u32`, such as `100000u32`, has type u32. Both are range checked at compile time. A signed literal ends in `i32`, for example `-800i32`. Signed addition and subtraction fault on overflow or underflow. Signed comparison uses numeric order. Division, multiplication and conversions to or from i32 are currently absent. Arithmetic checks the result range in every evaluation phase. Mixed arithmetic requires explicit widening. At the host boundary both types require primitive integer-valued numbers within range. Negative zero normalizes to zero.

A uuid holds any 128-bit pattern. Its host representation uses exactly 36 lowercase ASCII characters in hexadecimal groups of 8-4-4-4-12. Equality compares all bits. The boundary rejects alternate spellings, boxed strings and coercions. UUID version, issuance, ownership and uniqueness belong to the application. These scalars are available in fields, payloads, sequences and contracts.

## Reducer entries

```noi
(reducer parity ((state bool) (flip bool)) bool
  (reads)
  (capacity 8192)
  (invariant true)
  (ensures (= result (if flip (not state) state)))
  (if flip (not state) state))
```

Call `api.parity({}, initialState, flips)` with a dense array. The second declaration parameter names one element in the step. The output type must equal the state type. The invariant sees the current state and declared grants. The step and its guarantee also see the current element, and the guarantee sees the next state as `result`. The host can pass the returned state to a subsequent chunk under the next call's admission check. A step may call earlier helpers and ordinary imported functions. Reducers are host entries and can also be composed with `reduce` in a body. The independent clause applies to ordinary functions and helpers.

Entry validates and copies the initial state and the entire array, then snapshots grants once. A malformed tail yields ARGUMENT even after a row that would cause a business rejection. Entry checks the initial invariant, including for empty arrays. A false initial invariant yields PRECONDITION. In input order, each step checks admission, computes the next state and checks the invariant there and the explicit step guarantee. A false exit check yields POSTCONDITION. The empty array returns a fresh value equal to the admitted initial state. A business rejection can be represented in the state and retained by later steps. The host decides whether to commit.

Capacity is a literal from 1 through 65,535. The compiler limits (capacity + 1) times conservative step work to 4,000,000 and the initial state plus a maximum-length input to 1,000,000 language values. Snapshot size counts each scalar or compound value once and uses the largest alternative of a tagged type. These are structural bounds. Host trap execution, allocation size and wall-clock time depend on the runtime.

## Text

`text` is a primitive immutable sequence of zero through 1,024 UTF-16 code units. Quoted source literals use JSON string syntax. Whitespace, parentheses and semicolons inside a literal are data. The JS boundary accepts primitive strings within the limit. Boxed strings, coercions and overlong values fail with ARGUMENT. The source limit produces E_LIMIT. A supplementary character occupies two units. Lone surrogates are representable. Equality is exact and case-sensitive. The host owns normalization, locale, grapheme boundaries and application-specific identifier rules.

| Expression | Result |
| --- | --- |
| `(text-length s)` | u32 code-unit count |
| `(starts-with s p)`, `(ends-with s p)`, `(contains s p)` | bool for exact prefix, suffix or contiguous subsequence |
| `(strip-prefix s p)` | The suffix after one matching prefix, otherwise the original text |

The empty pattern matches at both ends and within every string. Removing it preserves the input. All operations are total on valid values and evaluate operands in order. Stripping can only shorten a value. An application requiring missing text can declare `(enum optional_text (missing) (present text))`. Missing required JS fields are boundary errors, and an explicit missing tag is a value the program can handle.

## Ordered collectors

```noi
(collect queued_jobs deliveries jobs
  (reads)
  (using select_job))
```

A collector is a public entry with one named sequence type for its input and one
for its output. Its selector must be a previously declared helper or a directly
imported ordinary function. Calls resolve to the checked selector under the
same exact import pins as ordinary calls. The selector takes one parameter of
the nominal input element type and returns an enum with exactly two variants.
`skip` has no payload and `emit` carries exactly one value of the nominal
output element type. The selector must explicitly declare `(requires true)`.
The collector declares every read in the selector's interface, including reads
required by its transitive calls.

The host supplies a flags object and one input array. The boundary validates
and snapshots the entire input before computation, then snapshots the grants
once. The collector visits the decoded elements once from left to right. It
appends the value of each `emit` and keeps duplicate emissions. Empty input and
all-skipped input return an empty array. The boundary returns a fresh dense
array and materializes each structured element independently. A malformed
input fails at the boundary. A reached selector fault fails the invocation
with its execution phase and exposes no partial output.

The declared output capacity must be at least the declared input capacity.
Static work charges the selector, a visit and a worst-case emitted value copy
per possible input element, plus construction of the output array. The
ordinary entry work limit applies. Collector entries have no source-level
whole-array contract and cannot be called from expressions.

## Composing sequence computations

`(append xs item)` evaluates the sequence and item in that order. The item must
have the nominal element type. At capacity the operation faults with
`CAPACITY`. Otherwise it returns a sequence of the same type with the item
after the existing elements. It leaves the input untouched. Its work estimate
charges the full sequence capacity for the copy. Appending repeatedly can take
quadratic work in the number of emitted elements.

Ordinary functions can use a fold with any typed accumulator, including a
sequence or a record containing multiple sequences and a tagged failure.
Functions can call helpers before, during and after the fold. Contracts can
use fold, length and membership over both arguments and the complete result.

`(reduce reducer initial xs)` can target an earlier local reducer or a
directly imported reducer by qualified name. The initial value has the
reducer’s state type. The sequence has the reducer’s item type and a capacity
within the reducer’s declared limit. The caller declares all the reducer’s
reads. The expression evaluates the initial value and sequence in that order,
checks the invariant even for an empty sequence, then executes the checked
transition in sequence order. Invariant admission failure is a
`CALL_PRECONDITION` fault. The state returned after the last element has the
same type as the initial value. `call` and `attempt` target ordinary frames.

## Capability-scoped lookups

`(lookup replenish stockroom stock_key decide)` exports
`services.replenish` alongside the two ordinary functions in `api`.
`stock_key` must return text. `decide` must accept the same positional
argument types followed by an enum with `found` carrying a typed value and
the nullary variants `missing` and `unavailable`. Its precondition is
literal `true`. Both stages must be local ordinary public functions. Imports
link the pure functions under their usual pins. Lookup declarations export
services from the entry module only.

A trusted JS or TypeScript host calls `grantLookup(resource, allowedKeys, read)`
and keeps the returned token. The artifact snapshots up to 4,096 exact text
keys. The service takes the token followed by the flags object and planner
arguments. It checks the token identity and namespace, snapshots arguments
and both stages’ required flags, runs the checked planner, and checks exact
key membership before calling the handler once. The handler is synchronous
and receives only the validated key. The generated TypeScript factory requires
a handler returning the declared reply enum for the resource. A thrown
handler produces the `unavailable` reply. A response that fails the enum or
payload checks produces `RESOURCE_RESPONSE` at the boundary. A returned
native promise also produces `RESOURCE_RESPONSE` immediately. The Node
artifact attaches a rejection handler to ordinary native promises so an
accidentally returned rejected promise leaves no unhandled rejection. The
service invokes the continuation on the snapshots and decoded reply and
returns a fresh value.

The token is local to its artifact instance. Ordinary Noitak values carry
no capability identity. The host controls grant issuance, handler behavior,
data freshness and external deadlines. The effect observes the resource, key
and occurrence of a request. A stage’s `independent` declaration retains its
ordinary admission and return-value meaning. The service itself has no
noninterference proof.
