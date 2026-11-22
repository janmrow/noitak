# Implementation

The CLI loads UTF-8 source and retains the original bytes for hashing. The lexer and parser in src/parser.mjs build located atoms and lists. src/frontend.mjs validates declaration shape, resolves lexical bindings with maps, checks types and checks every flag reference against the function declaration. It produces a closed expression tree of literals, resolved variable names and fixed operator tuples. Operators and variables occupy distinct tree positions. Source text cannot introduce JavaScript statements.

src/runtime.mjs contains the expression evaluator and entry points for execution, boundary validation and predicate evaluation. The enumerating verifier calls execute with typed arguments and a finite flag assignment. The generated wrapper uses invoke to validate JavaScript inputs, copy named grants and enter execute. Runtime contracts remain active after compilation. Choosing bounded scalars and acyclic expression trees makes every language evaluation finite and avoids numeric rounding within the supported arithmetic.

src/domain.mjs defines enumeration order. src/verify.mjs computes the domain size with BigInt before running the evaluator. src/diff.mjs reuses the same enumeration for eligible body comparisons. src/vectors.mjs uses the host entry point to exercise both boundary failures and program results.

src/backend.mjs serializes validated IR as data and embeds the evaluator in a standalone ES module. Each exported API method closes over its own function definition. No generated expression is passed to eval or Function. Sharing evaluation code reduces the risk of verifier/backend semantic drift, while making bugs in that code a common source of error. Independent expected outcomes in tests address selected cases of that risk.

The output uses an ESM declaration file with a matching basename so TypeScript resolves the interface through the normal NodeNext import path. The JS evaluator implements the finite value semantics directly. The generated module has no solver dependency. TypeScript is used only by the integration tests and demo.

In 0.2, checked enum types carry a sorted list of named variants. The frontend verifies constructor arity, payload types and complete pattern coverage. The domain generator, host boundary, declaration emitter and optional symbolic encoder consume the same closed declarations. The Noitak type checker distinguishes nominal enums. TypeScript represents their public shape structurally.

Contract refinement in src/refinement.mjs evaluates predicates on hypothetical results independently of the function body. The optional src/symbolic_worker.py instead builds formulas from the checked IR. src/symbolic.mjs bounds the worker lifetime, interprets its evidence and replays violating inputs in JS. A host importing a built module loads neither Python nor the solver.
