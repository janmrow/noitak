# Delivery acknowledgment review

The first acknowledgment records the supplied sequence number. Subsequent acknowledgments must return that original number, including when the caller supplies a different number. Every well-typed call is admitted. The module needs no host permissions. The accepted baseline for this exercise is examples/delivery.noi.

The TypeScript caller in host.mts submits sequence 17 and retries with sequence 23. A full proof covers every initial receipt and sequence. The candidate files represent independent proposals against that same baseline. cases.json is the facilitator's answer key, fixed before implementing the comparison engine.

Give a participant the requirement and the numbered text reports. For each report ask them to record a decision (accept, request a change, or request more evidence), their reason, whether the report alone was sufficient, whether they opened source, and what was missing. Reveal the answer key after collecting responses. Separately record a machine classification mismatch or an unhelpful explanation. The automated run checks reproducibility. Review effort has to be observed with participants.
