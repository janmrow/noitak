# Noitak 0.5

A service can submit an ordered batch of events to a verified component and receive a final ticket or the zero-based index of the first rejected event. Expected rejection carries no intermediate ticket. The TypeScript host changes storage only on success. This is suitable for bounded, deterministic validation and state-transition components with an application-owned persistence boundary.

## Install and operate

The exercised build platform is Linux with Node 22 and npm. The symbolic engine additionally uses Python 3.10+ and the version in requirements-symbolic.txt. A generated ES module has no external runtime dependencies. From a source checkout:

```sh
npm ci
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-symbolic.txt
npm test
npm run test:symbolic
npm run pilot -- build/pilot
npm run pilot:support -- build/support
npm run pilot:batch -- build/batch
npm run demo
npm run release:check -- build/distribution
```

Use fresh output directories. The last command packs the CLI, installs it offline in a separate consumer, gates the packaged batch using the installed command and worker, and exercises the generated ESM. It produces `noitak-0.5.0.tgz` and `SHA256SUMS`. GitHub Actions runs the suites and pilots and uploads the checked distribution. A maintainer can attach those two files from a passing version-tag build to a GitHub release. The package is private to prevent accidental publication to the npm registry.

In a host repository, install the tarball as a dev dependency and keep its lockfile. The included `pilot/support/batch.noi` and `support.noi` are a working import pair. For symbolic builds from the installed distribution:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r node_modules/noitak/requirements-symbolic.txt
./node_modules/.bin/noitak build node_modules/noitak/pilot/support/batch.noi build/tickets --engine symbolic
```

Use a trusted baseline for production change review. Require successful CLI termination and deploy the resulting exact bundle. The report binds source and dependency digests to proof configuration and artifact hashes. The checksums are unsigned. The release channel, compiler and baseline selection remain trusted. Coordinate persistence in the host with a transaction or equivalent concurrency check. A proved transition on a stale snapshot cannot protect a subsequent database write.

## Evidence

The batch pilot has 768 initial tickets, 85 ordered event sequences of length zero through three, and four staff contexts. It establishes the complete ordered transition and the first rejection index, plus independence of the outcome from staff data. The pilot runs Z3 and full enumeration separately; its 261,120 cases exceed the automatic dual-engine cross-check ceiling. A separate host loop checks all 261,120 calls against the generated artifact.

| Candidate | Observed decision |
| --- | --- |
| Reorder operands in the imported private increment helper and update its pin | Accepted. Both the imported transition and the root batch returned equal results on jointly admitted inputs. |
| Apply events in reverse order | Refused with a postcondition counterexample. |
| Commit the intermediate ticket on a rejected event | Refused with a postcondition counterexample. |
| Leak staff escalation through the reported failure index under a relaxed ordinary contract | Refused with two concrete calls that violate independence. |
| Remove the staff independence promise | Refused as a policy violation. |
| Delegate an additional flag through the root, imported transition and private helper | Refused as an authority expansion. |

The TypeScript host rejected the third event in a three-event batch at initial revision 253 and preserved the original ticket. A second batch with a private note succeeded at revision 255. An oversized array was rejected at the host boundary. A 4,096-case enumeration budget refused the batch build without publishing output.

On Linux with Node 22.23.1, TypeScript 5.9.3, Python 3.12.14 and Z3 4.13.4, the default suite passed 103 tests and the symbolic suite passed 31. Both earlier TypeScript pilots and the scalar demo passed alongside the batch pilot and offline tarball installation check.

## Linked graph measurement

The benchmark uses ten functions in which each helper calls its predecessor twice. On the same Node 22.23.1 installation the 0.4 standalone ESM measured 27,016 bytes; the 0.5 ESM measured 7,854 bytes. Median warm enumeration of the ten two-case obligations measured 1.158 ms and 1.419 ms respectively. Median change comparison for a behavior-preserving edit to the shared leaf measured 0.887 ms and 0.880 ms respectively, excluding the two revisions’ individual proofs. Each runner discarded three warmups and measured seven runs. The reduction was in artifact size. These timings are workload- and machine-specific.

```sh
baseline=$(mktemp -d)
git archive 091f35f | tar -x -C "$baseline"
node scripts/bench-graph.mjs "$baseline"
node scripts/bench-graph.mjs .
```

## Migration and limits

Existing 0.4 module syntax and positional calls remain supported within the revised work limits. The support source example is now named `support.noi` to match its import identity. Source locations count within the relevant module. Verification reports move from schema 3 to 4 and reviews from 4 to 5. Use `dependencies`, qualified function names, `visibility`, `calls` and `(function, property)` to read the evidence. An import pin change gets its own finding. Changes to imported public guarantees, return values or authority can independently block publication.

Sequences have capacity 1–8. Elements and success payloads are scalars, ordinary enums or records. Types are finite and nominal in Noitak, structural in TypeScript. Source loading and expression evaluation have explicit bounds. Overall verification time and process memory still depend on the module and domain. Run compilation of untrusted submissions in an externally resource-limited build environment. Verification establishes the stated obligations and assumes correct source resolution, translators, evaluator and execution environment. Authorization, timing, transaction isolation and the accuracy of business requirements remain outside the proof.
