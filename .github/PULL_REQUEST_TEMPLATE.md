## Summary

<!-- What does this PR do and why? -->

## Changes

<!-- Bullet list of the key changes -->

## Test plan

<!-- How was this tested? -->

---

## Reviewer checklist

### Token estimation

- [ ] Any new token counting uses `estimateTokens(rawValue)` for raw objects or `estimateSerializedTokens(jsonString)` for already-serialized strings — **never** `str.length / 4` (ESLint enforces this too)
- [ ] If the budget fast-path check in `recorder.ts` was touched, it still sums **both** call tokens (`events` table) and schema tokens (`tool_schema_metrics`) so the trigger threshold matches `getTokenSummary`

### Fail-open

- [ ] No new code path can throw in a way that blocks the proxy or hooks endpoint (wrap in try/catch where needed)
- [ ] New error conditions return 200 with `{ ok: true, warning: "..." }` rather than 4xx to never block Claude

### Redaction / privacy

- [ ] New payloads stored in the DB pass through `redactAndTruncate` (never raw user input)
- [ ] No prompt text, reasoning, or chain-of-thought is captured

### Database

- [ ] New migrations use `IF NOT EXISTS` / `IF NOT EXIST` guards so they are re-runnable
- [ ] Expression-based UNIQUE indexes (e.g. `COALESCE(col, '')`) are used where a column can be NULL to avoid silent duplicate rows
