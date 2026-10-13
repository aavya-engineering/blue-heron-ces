# mu — muster-api CLI

`mu` is a thin HTTP CLI that drives every endpoint of the muster-api.  
No new runtime dependencies — uses Node built-ins and native fetch.

## Install / Run

**Without building** (development):

```sh
# From muster-api/
npm run mu -- <args>

# Examples
npm run mu -- login --email ops@bhd.test --password hunter2
npm run mu -- engagements list --pretty
```

**After `npm run build`** (links the binary from package.json `"bin"`):

```sh
npm link          # adds `mu` to PATH
mu engagements list
```

## Authentication

`mu login` exchanges credentials for a JWT and writes it to `~/.muster/credentials.json`.

```sh
mu login --email ops@bhd.test --password hunter2
# or via env: MU_EMAIL=ops@bhd.test MU_PASSWORD=hunter2 mu login
```

Token resolution order (first wins):

1. `--token <TOKEN>` flag
2. `MU_TOKEN` environment variable
3. `~/.muster/credentials.json` (written by `mu login`)

```sh
mu logout     # deletes ~/.muster/credentials.json
mu whoami     # GET /auth/me — shows decoded JWT payload
```

## API base URL

Resolution order (first wins):

1. `--api-url <URL>` flag
2. `MU_API_URL` environment variable
3. `http://localhost:4000` (default)

## Global flags

| Flag | Description |
|---|---|
| `--api-url URL` | API base URL |
| `--token TOKEN` | Bearer token (skips credential file) |
| `--pretty` | Indented JSON output |

## Commands

Every command writes JSON to **stdout** (one object/array).  
Errors write `{"error": ..., "status": ...}` to **stderr**.

### Auth

```sh
mu login --email <e> --password <p>
mu logout
mu whoami
```

### Engagements

```sh
mu engagements list
mu engagements create --kind individual_contractor
mu engagements create --kind prime_and_subs
mu engagements get <id>
mu engagements progress <id>
```

### Parties

```sh
mu parties list --engagement <engagementId>
mu parties get <id>
mu parties action <partyId> send-nudge-now
mu parties action <partyId> mark-abandoned --notes "No response after 30 days"
mu parties action <partyId> disposition-ready
mu parties action <partyId> disposition-validate
mu parties action <partyId> convert-to-enclave
mu parties action <partyId> schedule-reassessment
mu parties action <partyId> opt-out
```

### Contracts

```sh
mu contracts list
mu contracts get <id>
mu contracts create --file contract.json
mu contracts update <id> --file updates.json
mu contracts delete <id>
```

`contract.json` fields: `party_id`, `engagement_id`, `contract_number`, `program_name`,
`cmmc_level_required` (1-3), `cui_categories` (array), plus optional `cage_code`, `uei`,
`contracting_office`, `co_name`, `award_date`, `pop_start`, `pop_end`.

### Sessions

```sh
mu sessions get <id>
mu sessions sync --file session.json
```

### HIL (Human-in-the-Loop)

```sh
mu hil queue
mu hil flag --file fact.json
mu hil resolve <id> --minutes 12.5
```

`fact.json` for `hil flag`:
```json
{
  "question_id": "AC.1.001",
  "fact": { "answer": "unknown", "confidence": "low", "weight": 3 }
}
```

### Interview

```sh
mu interview next --file next-req.json
mu interview retro --file facts.json
```

`next-req.json`: `{ sessionId, priorFacts, stacks, remainingQuestions }`.  
`facts.json` for retro: `{ facts: [{ question_id, answer }] }`.

### Coach

```sh
mu coach chat --file messages.json
```

`messages.json`: `{ sessionId, messages: [{ role: "user"|"assistant", content }] }`.

### Harvest

```sh
mu harvest run --file run-req.json
```

`run-req.json`: `{ "sim": true }` (local stacksim) or `{ "live": true, "engagement_id": "…", "consent_id": "…" }`
(a device-code consent from `/api/live`; the engagement's live flag must be on). A bare `access_token` is refused.
`mu harvest consent-url` is retired (FC-MU-3): the client-secret consent flow was removed; it exits 2.

### SPRS

```sh
mu sprs score --file results.json
```

`results.json`: `{ requirement_results: [{ requirement_id, status }] }`.  
Returns `{ sprs: -203..110, assessed_count, deductions }`.

### Nudges

```sh
mu nudges tick
mu nudges tick --now 2026-01-01T00:00:00.000Z
mu nudges tick --now 2026-01-01T00:00:00.000Z --engagement <id>
mu nudges digest --engagement <id>
mu nudges digest --engagement <id> --now 2026-01-01T00:00:00.000Z
```

### Reassessment

```sh
mu reassessment tick
mu reassessment tick --now 2026-01-01T00:00:00.000Z
mu reassessment drift-check --file drift.json
```

`drift.json`: `{ party_id, previous_facts, current_facts, session_id?, now? }`.

### Recipes

```sh
mu recipes list
mu recipes ingest --file output.json
mu recipes ingest --file output.json --concierge
```

`--concierge` adds `x-concierge-session: true` header (required when `RECIPES_SELF_SERVE` is off).

`output.json`: `{ recipe_name, output }`.

### Touch

```sh
mu touch report --engagement <id>
mu touch record --file event.json
```

`event.json`: `{ mode: "a"|"c", engagement_id, kind, minutes? }`.

## Reading body from stdin

Any `--file` argument accepts `@-` to read JSON from stdin:

```sh
echo '{"engagement_kind":"prime_and_subs"}' | mu engagements create --kind prime_and_subs
cat session.json | mu sessions sync --file @-
```

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Error (HTTP 4xx/5xx, bad arguments) |
| 2 | Unknown command / usage error |
| 3 | API degraded (HTTP 503 `{degraded:true}`) |

Exit code 3 is distinguishable from generic errors so callers can implement retry-or-fallback logic.
