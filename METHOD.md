# Method

1. Establish the fork base by diffing upstream patches against the published tree
   (mean presence of post-2023 upstream changes ≈ 0.10; base ≈ July–Sept 2023).
2. Enumerate upstream commits that add regression tests (`JSTests/`, `LayoutTests/`)
   after the base.
3. Extract those tests into the Sony tree and execute them:
   - crash → memory-safety bug
   - expectation failure → behavioural divergence (where silent bugs live)
   - environment failure → discard
4. Confirm every candidate: fix absent (quoted diff), deterministic 3/3, no `$vm` or
   ignored `//@` directives, and the relevant feature enabled on PlayStation.
5. For leaks: differential heap-fill testing (`malloc_fill_byte` A vs B) to detect
   uninitialised memory reaching JS.

Traps documented, all of which produced false positives before being caught:
broken JIT from bad build flags, tests needing `$vm`/`runNoFTL`, nondeterministic output,
and features compiled out on PS5 (`ENABLE_XSLT OFF`, `ENABLE_WEB_AUDIO OFF`,
`ENABLE_WEBGL OFF`, `USE_AVIF OFF`, `USE_JPEGXL OFF`).
