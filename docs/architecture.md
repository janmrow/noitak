# Implementation

The CLI loads UTF-8 source and retains the original bytes for hashing. The lexer and parser in src/parser.mjs build located atoms and lists. src/frontend.mjs validates declaration shape, resolves lexical bindings with maps, checks types and checks every flag reference against the function declaration. It produces a closed expression tree of literals, resolved variable names and fixed operator tuples. Operators and variables occupy distinct tree positions. Source text cannot introduce JavaScript statements.

src/runtime.mjs contains the expression evaluator and two entry points. The verifier calls execute with typed arguments and a finite flag assignment. The generated wrapper uses invoke to validate JavaScript inputs, copy named grants and enter execute. Runtime contracts remain active after compilation. Choosing bounded scalars and acyclic expression trees makes every language evaluation finite and avoids numeric rounding within the supported arithmetic.

src/domain.mjs defines enumeration order. src/verify.mjs computes the domain size with BigInt before running the evaluator. src/diff.mjs reuses the same enumeration for eligible body comparisons. src/vectors.mjs uses the host entry point to exercise both boundary failures and program results.

src/backend.mjs serializes validated IR as data and embeds the evaluator in a standalone ES module. Each exported API method closes over its own function definition. No generated expression is passed to eval or Function. Sharing evaluation code reduces the risk of verifier/backend semantic drift, while making bugs in that code a common source of error. Independent expected outcomes in tests address selected cases of that risk.

The output uses an ESM declaration file with a matching basename so TypeScript resolves the interface through the normal NodeNext import path. JS is sufficient for the scalar semantics and avoids introducing a separate code generator, memory ABI or solver dependency. TypeScript is used only by the integration tests and demo.
