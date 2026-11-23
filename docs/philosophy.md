# Verification-first programming

Noitak aims to become a practical programming language for software built primarily by AI agents, where safety, verifiable guarantees, and change control are first-class parts of programming.

Our design assumes that generating implementations becomes inexpensive, changes grow larger and more frequent, and people spend less time reading every line. These are assumptions about the future. In that setting a reviewer needs evidence about whom a change admits, what it promises those callers, and what authority it gives the program.

Ease of verification takes precedence over ease of writing. Human-readable contracts, explicit data and effects, and predictable execution make independent checks possible. Expressiveness matters for the same reason. If developers must move an ordinary data transformation into the host, its behavior falls outside the language's guarantees. A useful extension brings such work inside the checked component at a cost a project can sustain.

Consider a counter that must advance by exactly one. A change can preserve its implementation and every test while relaxing its contract to allow the counter to stand still. Comparing the promises for a hypothetical result reveals the lost guarantee. Comparing actual results answers a different review question. Both require a trusted baseline independent of the proposed edit.

Adoption starts with a single component in an existing application. The host supplies validated data and explicit grants and owns external operations. Each proof identifies its program, method and domain. A concrete witness explains a violation. A required obligation that remains unresolved blocks the gate. People decide whether the contracts capture the requirement, whether a deliberate change is authorized and whether the host can uphold its side of the boundary.
