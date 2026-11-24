# Signed ledger reconciliation

An ordinary function applies an ordered batch of signed adjustments to an
opening balance. The balance can range from −1,000,000 to 1,000,000 minor
units, inclusive. The first adjustment that would cross either limit puts
the ledger on hold and preserves the last accepted balance. Later adjustments
leave that state intact. For example, batches of `[1000000, 1, -1]` and
`[1000000, -1, 1]` have the same mathematical sum. Only the first batch
places the ledger on hold.

The reducer invariant bounds the balance after every accepted prefix. It
makes the subtraction of the current balance from either limit safe. The
step compares the signed adjustment with those differences before adding,
so even a maximum or minimum `i32` adjustment can be handled without
arithmetic overflow. The step contract checks the accepted addition and
preservation of the held state. The vectors check the business decision to
hold, including exact limits, order and signed extremes.

## Reproduce the baseline

With Node 22 and the pinned Z3 environment active, run from the repository
root.

```sh
out=$(mktemp -d)
node noitak.mjs build pilot/reconciliation/reconciliation.noi "$out/artifact" \
  --engine auto --vectors pilot/reconciliation/vectors.json

sed 's/adjustments i32 8)/adjustments i32 128 u32)/' \
  pilot/reconciliation/reconciliation.noi > "$out/reconciliation-128.noi"
node noitak.mjs verify "$out/reconciliation-128.noi" --engine auto --json
```

On 0.10 with Z3 4.13.4, the exact composed proof passed at 64 rows and was
canceled at 128. The reducer transition and prefix invariant still proved at
128. The build left no artifact with the composed obligation open. The next
milestone should prove and build `reconcile` at 128 using the proved
transition and a check that the seed satisfies its invariant. Check the
emitted result against an ordered integer model. Keep exact comparison or
an open result for claims the invariant cannot establish. At the small
capacity, strict change review rejects a step that holds on reaching the
lower limit exactly, even though it still preserves the balance invariant.
