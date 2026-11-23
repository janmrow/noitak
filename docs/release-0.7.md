# Noitak 0.7 engineering assessment

Noitak 0.7 compiles contracted components to standalone JavaScript with executable admission, arithmetic, authority and postcondition checks. The supported deployment path is a verified ESM component in a Node application. TypeScript declarations ship alongside it. The strict metering consumer can run with only its compiled service, the generated module and its application entry point. [Install and run the consumer](../README.md#use-a-component-in-typescript)

## Backend and evidence

Each reachable frame becomes three JS functions for admission, the body and the exit guarantee. Short-circuit branches stay lazy. Attempted calls evaluate the rejection index and all arguments in order. A reducer checks its initial invariant on empty input and checks each transition on nonempty input. Boundary readers copy dense arrays and own data fields before evaluating the component. Small record layouts have generated readers, while wider layouts retain the generic decoder. Noitak names enter generated code as quoted data. Source syntax, capabilities, host API and existing change-review rules continue to apply. [Architecture](architecture.md)

The prior interpreter remains the reference for finite proofs, counterexample replay and change comparison. Z3 retains its independent translation. Neither engine proves that JS lowering is correct. Build and gate therefore compare the exact ESM against the interpreter before publication. A short-lived worker checks the public surface, tagged outcomes and returned values on deterministic typed and invalid inputs. Each manifest records the ESM hash, backend ID and tested calls per export. A discrepancy, a worker error or a timeout blocks publication.

For a metering build the worker made 69 calls, with 38 returned values. For access it made 66 calls, with 64 returns. A narrow-admission regression fixture produced zero accepted inputs in 64 typed positions. That limitation is visible in the report. Applications still need accepted business cases against their packaged component. The separately written metering model, authorization table and 261,120-case support batch oracle exercise behavior beyond the generic probes. A deliberate negation mistranslation passed the source proof and diff. Both build and gate detected the first differing boolean return and produced no artifact. [Artifact comparison rules](verification.md#testing-the-emitted-artifact)

## Performance and cost

The baseline is the original 0.6 tree, also available at `5e22c0a`. Both versions used Linux, Node 22.23.1, Python 3.12.14 and Z3 4.13.4. Execution figures are medians of seven calls after four warmups. Allocation figures are approximate V8 sampling-profiler estimates per call, including collected objects, over a separate eight-call run. They measure allocation traffic. The access row is a block of 4,096 owner decisions.

| Workload | 0.6 median | 0.7 median | Estimated MiB allocated, 0.6 → 0.7 |
| --- | ---: | ---: | ---: |
| Accept 8,192 meter readings | 44.02 ms | 7.08 ms | 166.69 → 24.08 |
| Reject the first reading and retain the rejection | 16.34 ms | 3.64 ms | 53.98 → 11.53 |
| Reject a malformed final row at entry | 6.17 ms | 2.29 ms | 6.52 → 5.03 |
| Authorize 4,096 owners | 14.06 ms | 4.17 ms | 31.22 → 12.25 |

On 0.6, copying the full reading array alone took 6.63 ms. Evaluating step bodies over prepared states took 30.26 ms including nested helper contracts. Evaluating the top-level admission and exit predicates separately took 18.39 ms. These independent timed loops have different call overhead and do not sum to an end-to-end measurement.

The metering ESM shrank from 10,793 to 9,590 bytes, and access from 9,720 to 8,297 bytes. Bundle creation *after proof* increased from 1.90 to 37.69 ms for metering and from 1.09 to 34.94 ms for access. These medians include constructing the bundle, writing to a fresh directory and, in 0.7, running the separate ESM comparison. Source proof medians on 0.7 were 342 ms for metering and 154 ms for access. The ordinary strict TypeScript metering model took 0.173 ms on trusted inputs in a separate run. It omits host snapshots and executable contracts. Benchmark figures depend on the process and machine.

```sh
baseline=$(mktemp -d)
git archive 5e22c0a | tar -x -C "$baseline"
node scripts/bench-execution.mjs "$baseline"
node scripts/bench-execution.mjs .
node scripts/bench-reducers.mjs .
```

## Release and operation

From a clean checkout with Node 22 and the pinned Python environment, run the following commands with fresh destinations.

```sh
npm ci
npm test
npm run test:symbolic
npm run pilot -- build/delivery
npm run pilot:support -- build/support
npm run pilot:batch -- build/batch
npm run demo
npm run release:check -- build/distribution
(cd build/distribution && sha256sum --check SHA256SUMS)
```

Local validation passed 120 default tests, 38 symbolic tests, all three existing pilots and the demo. A missing Python executable during the installed-package gate left the distribution destination absent. Restoring the solver and retrying the same destination succeeded.

The release check stages the archive, installs it offline in an isolated npm consumer, gates both a pinned import graph and a real metering rewrite, validates the bundle hashes, and compiles the strict TypeScript service. It copies only the deployable JS files to a new directory and executes them with an empty executable search path and dynamic string compilation disabled. The distribution becomes available after all checks succeed. The package remains private to npm. A GitHub release maintainer can attach the tarball and SHA256SUMS from the passing workflow for the matching version tag.

For deployment, pin the build tool and solver, keep the baseline under independent change control, require a successful gate and promote its exact directory. Retain report.json and review.json with the release record. Schema 5 verification and schema 6 review remain compatible, with additive backend and artifact evidence. Regenerate and review artifact hashes on upgrade. Older deployed 0.6 ESMs remain standalone.

The checks cover deterministic language values and the stated contracts. They trust the frontend, emitter, shared boundary primitives, selected proof engines, JS runtime and trusted artifact delivery. The comparison worker runs with the build process’s authority. Use a resource-limited build environment for untrusted submissions. The host owns authentication, time, persistent storage, isolation between writers and rollback. Use the measured latency and memory behavior to size the application under its own load.
