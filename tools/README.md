# Porting tools

While the port is in progress, `toptutorsforus_service` (Python) is the
reference implementation. These scripts check that this one agrees with it over
a large input space, rather than only on the cases somebody thought to write a
test for.

The pattern is the same each time: a Python script writes the reference answers
to JSON, and a TypeScript script replays the same inputs and diffs.

```bash
# in toptutorsforus_service
uv run python tools/oracle_time.py /tmp/oracle_time.json

# here
npx tsx tools/parity-time.mts /tmp/oracle_time.json
```

A run of `resolveCivil` over 10 zones × 365 days × 8 times of day — 29,200
cases, including Lord Howe's 30-minute DST and Chatham's +12:45 — reports zero
mismatches, with 10 spring-forward gaps and 8 fall-back ambiguities in the grid.
Both edge policies are exercised, not merely present.

## Contrast

`contrast.mjs` measures the palette against WCAG in both colour schemes. The
brand tokens are used as text, as backgrounds behind text, and as borders, and
each wants a different ratio; a palette change that suits one can fail another
without anything looking broken. The pairs that matter are declared in the
script and checked rather than judged by eye.

```bash
node tools/contrast.mjs
```

It exits non-zero if any declared pair falls below its threshold. It found the
dark scheme rendering white on a light tint at 2.10:1 — every primary button,
the skip link and the step indicator — which is why `--on-brand` exists.
