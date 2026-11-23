# Noitak 0.5

Noitak compiles verified, finite state transitions and projections into standalone JavaScript modules with TypeScript declarations. A module can consume a structured snapshot, call contracted helpers and return a new value. A change gate checks admission, guarantees, observed returns and authority before publishing a candidate. [Project philosophy](docs/philosophy.md)

## Use 0.5 in an application

A module can import a pinned transition library, process a bounded sequence and return either the final state or the first rejected index. The compiler checks the batch contract, explicit authority and any declared independence of the result. The host owns persistence. [Batch source](pilot/support/batch.noi) · [TypeScript caller](pilot/support/batch-service.mts)

The distribution is an npm-format tarball for use as a pinned build dependency. In the directory containing the release assets, check their digest. From a host project, install the tarball and run its local command:

```sh
sha256sum --check SHA256SUMS
npm install --save-dev ./noitak-0.5.0.tgz
./node_modules/.bin/noitak --version
./node_modules/.bin/noitak build node_modules/noitak/examples/quota.noi build/quota
```

Ship the generated ESM to the application. Generated modules need neither Noitak nor a solver at runtime. For a change-controlled deployment use `gate BASELINE CANDIDATE NEW_DIR` and consume the bundle only on exit zero. For symbolic verification install the pinned Python dependency in the build environment. [Installation, supported use and release evidence](docs/release-0.5.md)

| Capability | 0.4 | 0.5 |
| --- | --- | --- |
| Composition | Private helpers embedded at call sites | Linked call frames and digest-pinned public imports |
| Data and control flow | Records, tagged values and branches | Bounded sequences, indexed folds and typed outcomes |
| Failure | False nested admission faults a strict caller | An attempted call can return a typed rejection and index |
| Change review | Contracts, returns, reads and independence within a module | Adds dependency digests and relational checks across reachable module calls |

## Run the support workflow

Use Node.js 22+, npm and Python 3.10+ with venv and pip. From the repository root run:

```sh
npm ci
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-symbolic.txt
npm test
npm run test:symbolic
npm run pilot:support -- build/support
npm run pilot:batch -- build/batch
```

The single-event pilot gates three revisions, compiles a strict TypeScript ticket service against the accepted bundle and processes four events. The rejected candidates alter a public revision on a private note and expose a staff escalation bit in a customer response. Each decision has a JSON report. The pilot requires a fresh output directory. [Workflow and evidence](pilot/support/README.md)

The batch pilot accepts one imported rewrite and refuses five candidate changes. It checks all 261,120 event-batch outcomes against an independent host model.

With Node alone you can enumerate the baseline and run five host-boundary vectors:

```sh
node noitak.mjs verify pilot/support/support.noi --json
node noitak.mjs test pilot/support/support.noi examples/support-vectors.json
```

## Run the scalar example

Use Node.js 22+ and npm. The compiler uses Node built-ins. The default workflow uses the pinned TypeScript compiler to check the host application. The optional symbolic engine uses Python and Z3.

```sh
npm ci
npm test
npm run demo
```

The demo builds the quota example in a temporary directory, compiles a strict TypeScript caller, runs it, finds a failing input in a second implementation, and compares a proposed update with the original module.

## Run the delivery change-review pilot

Use Node.js 22+ and Python 3.10+ with venv and pip. From the repository root:

```sh
npm ci
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-symbolic.txt
npm run pilot -- build/pilot
```

Open the numbered `review.txt` files beside `build/pilot/worksheet.md`. One candidate may be built. Four others exercise a weakened guarantee, a changed observable result, a new permission and a proof budget refusal. The runner checks the expected decisions, validates artifact digests, compiles a strict TypeScript consumer and invokes the approved module. Use a fresh output directory for another session. [Participant instructions and requirement](pilot/delivery/README.md)

To gate a single candidate from a host project, supply the accepted baseline from your trusted revision and a fresh destination. The command takes one snapshot of the candidate and builds from that snapshot only after its comparison passes.

```sh
node noitak.mjs gate examples/delivery.noi pilot/delivery/rewrite.noi build/accepted --engine symbolic
```

The accepted bundle includes `module.mjs`, `module.d.mts`, `review.json` and `report.json`. Check the exit status before using it. Independent verification is available with `verify` and comparison without writing artifacts with `diff`.

## A verified module

```noi
(module quota 0.1.0
  (fn remaining ((available byte) (requested byte)) byte
    (reads)
    (requires true)
    (ensures (and (<= result available)
                 (= (+ result (if (< available requested) available requested)) available)))
    (if (< available requested) 0 (- available requested))))
```

The contract says that remaining capacity plus the amount served equals the original capacity. Even the addition in the contract must stay within the byte range. The verifier checks 256 × 256 input pairs.

```sh
node noitak.mjs check examples/quota.noi
node noitak.mjs verify examples/quota.noi --json
node noitak.mjs test examples/quota.noi examples/vectors.json
node noitak.mjs build examples/quota.noi build/quota
cp examples/host.mts build/host.mts
./node_modules/.bin/tsc --strict --module nodenext build/host.mts
node build/host.mjs
```

The host prints 5. Build takes a **new** destination directory and emits module.mjs, module.d.mts and report.json together. Choose a fresh directory for another build. The ES module has no runtime dependencies. A caller imports the exported api object and handles the tagged result.

```ts
import { api } from './quota/module.mjs';

const balance = api.remaining({}, 8, 3);
if (!balance.ok) throw new Error(balance.code);
console.log(balance.value);
```

## Reproduce a failure or review a change

Each command below exits with code 1.

```sh
node noitak.mjs verify examples/broken.noi
node noitak.mjs verify examples/maintenance.noi
node noitak.mjs diff examples/quota.noi examples/maintenance.noi --limit 131072 --json
```

The first command finds a request of two units against one available. The implementation returns one when the contract requires zero. The second encounters a domain larger than the default budget of 65,536 tuples per function. The third allows both proofs to finish. It flags a new read of the host's paused flag and a changed contract. It grants no deployment approval.

## Contract review and tagged values

```sh
node noitak.mjs diff examples/refinement/original.noi examples/refinement/weakened.noi
node noitak.mjs verify examples/delivery.noi --limit 65792
```

The first command exits 1. For input 0 the revised contract permits a hypothetical return of 0. The old promise required 1. Both bodies still return 1. The second command proves that acknowledging a delivery preserves an existing receipt or records the new sequence number. Its domain has 257 receipt states and 256 possible sequence numbers.

## Optional symbolic proof

From a Python 3.10+ environment with venv and pip available:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-symbolic.txt
npm run test:symbolic
node noitak.mjs verify examples/reserve.noi --engine symbolic --json
node noitak.mjs build examples/reserve.noi build/inventory --engine symbolic
```

The inventory module has 16,777,216 possible inputs. Z3 checks whether any input could fault or violate the contract, then checks that at least one input is admitted. The proof report records both solver answers. Z3 runs during symbolic verification. The generated JS module runs in the host with no Python or Z3 installation.

## CLI in automation

| Command | Success condition |
| --- | --- |
| check FILE | Parses, resolves and type-checks the whole module, including declared flag accesses |
| verify FILE | Every required proof passes |
| build FILE NEW_DIR | Verification passes and all artifacts are written |
| test FILE VECTORS | All JSON vectors match the observed tagged outcomes |
| diff OLD NEW | Both revisions pass verification and all findings are compatible |
| gate OLD NEW NEW_DIR | The comparison passes and the candidate bundle is written |

The original `node noi.mjs` entry point remains available for existing scripts. Append `--json` for a single machine-readable JSON object on stdout. Verification and comparison accept `--limit N` (1 through 1,000,000 per function). Exit 0 means the requested command succeeded, 1 indicates a source diagnostic, failed test, blocked proof or change requiring review, and 2 indicates an invocation, I/O, data-format or tool error. CI should require exit 0 and consume output from that invocation. Source diagnostics include a stable code, file and one-based line and column. Success of check is only static acceptance.

## Scope

The proof covers execution on the declared finite domains and assumes the compiler, evaluator and JS environment implement the documented semantics. TypeScript describes bytes as numbers. The runtime checks their actual range. Flag reads consume explicit host data. Observable independence covers annotated parameters, typed inputs and fixed flags. Application authorization, timing, storage and host code sit outside the proof. Source and artifact digests identify bytes. Distribution and signer identity require separate controls.

- [0.4 engineering assessment and migration](docs/release-0.4.md)
- [Language and execution rules](docs/language.md)
- [Proof evidence, comparison rules and trusted components](docs/verification.md)
- [Implementation architecture](docs/architecture.md)
- [Verification-first design](docs/philosophy.md)
- [Roadmap and milestone disposition](docs/roadmap.md)

## License

Noitak is licensed under the [Apache License, Version 2.0](LICENSE).
