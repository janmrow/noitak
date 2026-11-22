# Noitak 0.1

Noitak is an experimental language for small decisions that need independently checkable contracts. Its compiler accepts bounded integer and boolean functions, checks their declared reads, and can exhaustively verify their behavior before producing an ES module. Its change gate asks a different question from the proof gate. Two versions can each satisfy their contracts and still differ in behavior or authority.

## Run the experiment

Use Node.js 22+ and npm. The compiler uses Node built-ins. The only development dependency is the pinned TypeScript compiler used to check the host application.

```sh
npm ci
npm test
npm run demo
```

The demo builds the quota example in a temporary directory, compiles a strict TypeScript caller, runs it, finds a failing input in a second implementation, and compares a proposed update with the original module.

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

## CLI in automation

| Command | Success condition |
| --- | --- |
| check FILE | Parses, resolves and type-checks the whole module, including declared flag accesses |
| verify FILE | Every required proof passes |
| build FILE NEW_DIR | Verification passes and all artifacts are written |
| test FILE VECTORS | All JSON vectors match the observed tagged outcomes |
| diff OLD NEW | The candidate passes verification and the comparison has only compatible changes |

Append `--json` for a single machine-readable JSON object on stdout. Verification and comparison accept `--limit N` (1 through 1,000,000 per function). Exit 0 means the requested command succeeded, 1 indicates a source diagnostic, failed test, blocked proof or change requiring review, and 2 indicates an invocation, I/O, data-format or tool error. CI should require exit 0 and consume output from that invocation. Source diagnostics include a stable code, file and one-based line and column. Success of check is only static acceptance.

## Scope

The proof covers execution on the declared finite domains and assumes the compiler, evaluator and JS environment implement the documented semantics. TypeScript describes bytes as numbers. The runtime checks their actual range. Flag reads consume explicit host data. Application authorization, confidentiality, timing, and code outside the module sit outside the proof. Source and artifact digests identify bytes. Distribution and signer identity require separate controls.

- [Language and execution rules](docs/language.md)
- [Proof evidence, comparison rules and trusted components](docs/verification.md)
- [Implementation architecture](docs/architecture.md)
- [Verification-first design](docs/philosophy.md)
- [Potential next experiments](docs/roadmap.md)
