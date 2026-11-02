# REQ-ces-mono-ec-script — add an `ec` script to the mono root package.json

**From:** ces-ec (EC-M2M3, 2026-09-28) · **To:** ces-mono root · **Plan:** File Inventory row for the root package.json
**Status:** OPEN — this session's grant covered only adding `ces-ec` to `workspaces` (done).

## Ask
Add, next to the other module scripts: `"ec": "npm run start -w ces-ec"` and, optionally, `"test:ec": "npm test -w ces-ec"` in the root `test` chain.
