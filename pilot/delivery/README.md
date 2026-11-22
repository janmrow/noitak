# Delivery acknowledgment review

The first acknowledgment records the supplied sequence number. Subsequent acknowledgments must return that original number, including when the caller supplies a different number. Every well-typed call is admitted. The module needs no host permissions. The accepted baseline for this exercise is examples/delivery.noi.

The TypeScript caller in host.mts submits sequence 17 and retries with sequence 23. A full proof covers every initial receipt and sequence. The candidate files represent independent proposals against that same baseline. cases.json is the facilitator's answer key, fixed before implementing the comparison engine.

Give a participant the requirement and the numbered text reports. For each report ask them to record a decision (accept, request a change, or request more evidence), their reason, whether the report alone was sufficient, whether they opened source, and what was missing. Reveal the answer key after collecting responses. Separately record a machine classification mismatch or an unhelpful explanation. The automated run checks reproducibility. Review effort has to be observed with participants.

## Run a session

In each numbered report, `./artifact` refers to the bundle beside that report. Keep the case directory together when moving or downloading a session.

From the repository root, activate the Python environment containing the pinned Z3 version, run npm ci and then run `npm run pilot -- build/session-1`. Each fresh session directory holds a worksheet, five numbered reports in text and JSON, and the accepted JS bundle with its compiled TypeScript caller. The runner refuses to overwrite a previous session. Keep participant responses separate from the fixed answer key. The CI workflow executes the same command and retains the reports with the run.
