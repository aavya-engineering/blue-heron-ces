# REQ-STACKSIM-STARTSWITH-FILTER-PASSTHROUGH — filed against tenant-stacksim (from ces-tester, 2026-07-28)

**Boundary note:** requirement doc, not a patch (tenant-stacksim fixes go through its
own sessions; the GP-DEMO-1 fix-at-source precedent applies when picked up).

## Finding

`ResolverTable.ts:applyCmdletFilter` parses bare OData literals (fixed 765d215) but
**`startsWith(...)` filter expressions pass through unfiltered** — the resolver
returns the whole collection instead of the filtered subset. Surfaced by the
GP-DEMO-2 wiring-spec oracle: discovery probe `AC.L2-3.1.6.admin-account` (a
`startsWith` filter over users) therefore degrades to "any user exists → met", which
weakens it as a correctness probe (excluded from the 5-config gate's probe set for
that reason).

## Why it matters

Sim-transparency: a real Graph tenant evaluates `startsWith` server-side. Any
consumer filtering by prefix (discovery get_commands, future Stamper verifications,
EO signals) silently receives over-broad results in sim — the same class as the
`-Filter` bare-literal gap fixed in 765d215 and the `-Identity` gap fixed in 56ae777.

## Ask

Extend `applyCmdletFilter` (and the URI-side `$filter` path if applicable) to
evaluate `startsWith(field,'value')` (and its `endsWith`/`contains` siblings if
cheap) against the collection, with a round-trip test per the ResolverTable.test.ts
pattern. Estimated small (the 765d215/56ae777 mechanism extends naturally).
