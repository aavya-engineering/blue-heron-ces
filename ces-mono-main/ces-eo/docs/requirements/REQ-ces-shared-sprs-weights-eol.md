# REQ — ces-shared: pin JSON data files to LF so byte-level parity holds on Windows checkouts

- **Filed by:** ces-eo (W4 close-out, 2026-09-27)
- **Target:** ces-shared (repo `.gitattributes`)
- **Status:** OPEN

## Problem
`ces-eo/tests/unit/sprs-weights-parity.test.ts` checks that every copy of the SPRS weights table is byte-identical to
the table EO loads (`ces-shared/dist/data/sprs-weights.json`, built from `src/data/sprs-weights.json`). The repo has no
`.gitattributes`, and this machine uses `core.autocrlf=true`. At 14:14 on 2026-09-27 a git operation re-checked out
`ces-shared/src/data/sprs-weights.json` with CRLF endings (`git ls-files --eol` = `i/lf w/crlf`), and dist was rebuilt from it.
The content equals HEAD, but the bytes (sha256 `5e24ae43…`) no longer match ces-muster's vendored LF copy and
vendor-manifest pin (`effcf570…`). Result: 3 parity tests fail in ces-eo although nothing changed.

## Ask
Add `.gitattributes` with `*.json text eol=lf` (at least for `src/data/**`), then renormalize the working copy and rebuild
`dist`. This keeps data files LF on every checkout, whatever `core.autocrlf` is set to.

## Acceptance
`git ls-files --eol ces-shared/src/data/sprs-weights.json` shows `w/lf`, and `npx jest tests/unit/sprs-weights-parity` in ces-eo passes.
