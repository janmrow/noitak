# Support ticket workflow

A TypeScript service holds customer-visible ticket state and staff-only routing context for each row. Customers can reopen a ticket by replying. An agent reply waits for the customer. Resolution closes the ticket. Every public event consumes one revision. A private note preserves the public snapshot, including at revision 255. The host handles revision exhaustion as an explicit application result.

[tickets.noi](tickets.noi) defines three operations. `transition` computes the next ticket using two private helpers. `public_view` projects its customer response and promises independence from the entire staff context. `route` uses that same context to send open escalations to an on-call queue when staff coverage exists. [service.mts](service.mts) owns storage, missing-ticket handling and dispatch. It compiles against the generated declarations and imports the approved ESM.

After installing the README dependencies and activating the Python environment:

```sh
npm run pilot:support -- build/support
```

The runner creates a fresh directory, saves each exact candidate source and CLI report, checks exit codes and checks for the presence or absence of the artifact directory. Inspect `approved/review.json` alongside the refused reports.

| Candidate | Expected evidence |
| --- | --- |
| approved | Reorder operands in the private revision helper. Both revisions prove their contracts. The public transition returns equal records for all jointly admitted inputs. |
| note-bumps-revision | A staff note advances the public revision. Transition verification produces an admitted input that faults or violates its postcondition. Publication is blocked. |
| staff-leak | The public waiting indicator also reveals escalation. All five ordinary safety proofs pass. Two typed calls with identical public inputs demonstrate the failed independence guarantee. Publication is blocked. |

The accepted host scenario reopens T42, dispatches once, resolves it at revision 255, accepts a private note, then rejects another public edit. An independent table in the default test suite also checks the emitted functions across every typed state and event or staff-context assignment.

The baseline requirement, trusted revision selection, host database, authorization, queue delivery and correctness of the host's choice of projection are outside the proof. This is an in-memory integration experiment. Byte-sized revisions deliberately make rollover a reachable test case. A production service would need a larger revision type and an atomic persistence strategy.
