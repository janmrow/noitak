# Noitak 0.10

Noitak aims to become a practical programming language for software built primarily by AI agents, where safety, verifiable guarantees, and change control are first-class parts of programming. It compiles contracted computations and capability-scoped lookup services to standalone JavaScript with TypeScript declarations. [Project philosophy](docs/philosophy.md)

Ordinary functions can build typed intermediate sequences, fold them into records, and call verified reducer steps through a bounded reduction. A shipment assessment filters calibrated signed readings, retains ordered excursions, and makes a quarantine decision. An inventory service plans an authorized stock lookup and handles its typed reply. A reviewer can authorize return differences for named functions in an exact revision. [Engineering assessment](docs/release-0.10.md)

With Node 22, TypeScript and the pinned Python environment installed, run the two evaluations from the checkout. Each command creates a fresh output directory.

```sh
npm run bench:changes -- build/coldchain
npm run pilot:inventory -- build/inventory
```

## Earlier workloads

With Node 22, npm dependencies and the pinned Python environment installed as below, run the comparison from the checkout. Each destination must be fresh.

```sh
npm run pilot:components -- build/components
node noitak.mjs build pilot/events/events.noi build/dispatch --engine auto --vectors pilot/events/vectors.json
```

Import `api.dispatch_push` from `build/dispatch/module.mjs`. Pass a repository, a tagged change, and up to 128 labels in the delivery argument, followed by a trace string. A deleted branch returns an ignored decision. An admitted branch push returns a typed job whose urgency follows label membership. Applications supply their own webhook authentication and scheduling. The comparison writes `comparison.json`, both generated components, strict TypeScript consumers and two refused policy reviews. [Delivery examples](pilot/events/vectors.json) · [Topic service](pilot/topics/service.mts)

The webhook collector moves batch selection into the component. Pass up to 32
typed deliveries to `api.queued_jobs` and receive a typed array of jobs in
delivery order, including duplicates. Run `npm run pilot:collect -- build/collect`
to reproduce the selector proof, accepted rewrite, rejected lost-job change
and reversed-backend test. [Collector](pilot/events/collect.noi) · [Strict TypeScript caller](pilot/collect/service.mts) · [0.9 assessment](docs/release-0.9.md)

## Use a component in TypeScript

The metering reducer reconciles ordered readings against a meter's serial number and quota. It accepts up to 8,192 records per call. The verifier checks one transition for every valid state and reading, then uses induction to establish that usage stays within quota after every prefix. A separate tenant-access policy checks ownership, revocation, delegated grants and expiration using canonical identifiers. [Metering component](pilot/metering/metering.noi) · [TypeScript consumer](pilot/metering/service.mts) · [Access policy](pilot/access/access.noi)

Build a development tarball from a checkout with Node 22+, npm and Python 3.10+. Use a fresh destination for each release check.

```sh
npm ci
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-symbolic.txt
npm run release:check -- build/distribution
```

In a TypeScript application, install the checked tarball as a dev dependency. Place the tarball and its SHA256SUMS from the trusted release in the project root. These commands assume TypeScript is installed and the Python build environment is active.

```sh
sha256sum --check SHA256SUMS
npm install --save-dev ./noitak-0.10.0.tgz
python -m pip install -r node_modules/noitak/requirements-symbolic.txt
npx --no-install noitak verify node_modules/noitak/pilot/metering/metering.noi --engine auto
npx --no-install noitak build node_modules/noitak/pilot/metering/metering.noi meter/verified --engine auto
cp node_modules/noitak/pilot/metering/service.mts meter/service.mts
npx --no-install tsc --strict --module nodenext meter/service.mts
cp node_modules/noitak/pilot/metering/demo.mjs meter/demo.mjs
node meter/demo.mjs
```

Import `MeterStore` from `./meter/service.mjs` or call `api.reconcile(flags, account, readings)` from the generated module. Ship the ESM with the application. Python and Z3 run only at build time. For updates, use a trusted baseline, edit a separate candidate, and consume the fresh candidate bundle after a successful gate.

```sh
npx --no-install noitak gate baseline/metering.noi candidate/metering.noi next/verified --engine auto
```

The release check installs the package offline, makes a real implementation edit, gates it and runs a strict TypeScript consumer against the approved bytes. Read the assessment for timings, security assumptions and migration details. [0.8 engineering assessment](docs/release-0.8.md)

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
node noitak.mjs build examples/reserve.noi build/reserve --engine symbolic
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
| gate OLD NEW NEW_DIR | Strict compatibility or a scoped authorization passes, and the validated candidate bundle is written |

The original `node noi.mjs` entry point remains available for existing scripts. Append `--json` for a single machine-readable JSON object on stdout. Build and gate additionally accept `--vectors FILE` to require application cases against the artifact. Verification and comparison accept `--limit N` (1 through 1,000,000 per function). Exit 0 means the requested command succeeded, 1 indicates a source diagnostic, failed test, blocked proof or change requiring review, and 2 indicates an invocation, I/O, data-format or tool error. CI should require exit 0 and consume output from that invocation. Source diagnostics include a stable code, file and one-based line and column. Success of check is only static acceptance.

To accept an intentional witnessed change, pass `--authorization POLICY` to
gate from the trusted review workflow. Keep that file and the selected
baseline under independent control. [Authorization format](docs/verification.md#authorizing-an-intentional-change)

## Scope

The proof covers declared input domains and, for reducers, invariant-preserving steps and assumes the compiler, evaluator and JS environment implement the documented semantics. TypeScript describes integers as numbers and UUIDs as strings. The runtime checks ranges and canonical form. Flag reads consume explicit host data. Observable independence covers annotated parameters, typed inputs and fixed flags. Application authorization, timing, storage and host code sit outside the proof. Source and artifact digests identify bytes. Distribution and signer identity require separate controls.

- [0.4 engineering assessment and migration](docs/release-0.4.md)
- [Language and execution rules](docs/language.md)
- [Proof evidence, comparison rules and trusted components](docs/verification.md)
- [Implementation architecture](docs/architecture.md)
- [Verification-first design](docs/philosophy.md)
- [Roadmap and milestone disposition](docs/roadmap.md)

## License

Noitak is licensed under the [Apache License, Version 2.0](LICENSE).
