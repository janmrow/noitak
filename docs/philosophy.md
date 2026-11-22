# Verification-first programming

Noitak explores a future in which agents generate most implementations and people decide which changes to accept. In that setting, ease of verification takes precedence over ease of writing. An agent may propose both a function and its contract. The reviewer needs to know whom the contract admits, what it promises those callers, and which resources the function can read.

Consider a counter that must advance by exactly one. An edit can preserve its implementation and every existing test while changing its contract to allow the counter to stand still. A concrete input and a newly permitted result show the reviewer exactly which promise would be lost.

Noitak checks such claims independently of their author. Each proof identifies its program, method and domain. A witness explains a violation. An unresolved obligation remains visible and blocks the relevant gate. People still decide whether the stated guarantees capture the real requirement and whether the host should grant the requested authority.
