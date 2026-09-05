# Auth + sync Lambda (`home-management-sync`)

This is the source for the AWS Lambda behind the household app's cloud sync and
user authentication. It is fronted by the HTTP API `home-management-sync-api`
(`cu3nr7fq95`) and stores everything as JSON objects in the S3 bucket
`home-management-sync-450118321037`.

## Routes

- `POST /auth/register` — `{email, name, password}` → creates a **pending**
  user. The configured admin email is auto-approved with the `admin` role.
- `POST /auth/login` — `{email, password}` → returns an HMAC-signed token for
  approved users; `403 {status:"pending"|"rejected"}` otherwise.
- `POST /auth/me` — returns the caller's profile (requires token).
- `POST /auth/users` — admin only: list all users.
- `POST /auth/approve` — admin only: `{email, status}` where status is
  `approved` / `rejected` / `pending`.
- `POST /auth/remove` — admin only: `{email}` deletes a user.
- `GET /data` / `PUT /data` — the household data blob, now gated: only a valid
  **approved-user token** (Authorization: Bearer …) is accepted.

## Open Finance (live bank / card sync)

All routes are `POST /of/{action}` and require an approved-user token. The
Open Finance credentials (`userId`, `clientId`, `clientSecret`) live only in
S3 at `data/__of_config__.json` and are never returned to the browser
(`config` responses are masked).

- `config` — admin only: `{userId, clientId, clientSecret, autoSync}` stores the
  keys after verifying them against `https://api.open-finance.ai/oauth/token`.
  `{clear:true}` removes them.
- `status` — connections (`GET /v2/connections`) and accounts
  (`GET /v2/data/accounts`) with balances, credit limits, mortgage balances.
- `connect` — admin only: creates a connection (`POST /v2/connections`) and
  returns the consent-journey URL (`scaOAuth`) to open at the bank.
- `refresh` — asks Open Finance to refetch all connections for the user.
- `sync` — `{dateFrom, dateTo}` pulls `GET /v2/data/transactions` (paginated),
  keeps only CHECKING + CARD transactions, drops `isDuplicate`, and returns rows
  normalised to the app's import format (`date, merchant, description, amount,
  kind, ref, of_id, source, account, of_cat`). Card accounts are named by issuer
  (`ישראכרט ••2613`, `אמריקן אקספרס ••8754`) so the bank's aggregate card
  debit is recognised as covered by the itemised detail. The client syncs in
  two-month windows to stay inside the API Gateway 30 s limit.

Sign convention (verified against live data): negative `chargedAmount` is a
debit for both bank and card transactions; `classification.type`
(`*_EXPENSE` / `*_INCOME`) overrides the sign when present.

## Configuration (Lambda environment variables)

- `BUCKET` — S3 bucket for storage.
- `AUTH_SECRET` — HMAC signing secret for tokens (keep private; rotating it
  invalidates all existing sessions).
- `ADMIN_EMAIL` — the single email allowed to hold the `admin` role.
- `HOUSEHOLD_CODE` — internal key selecting the shared household data object;
  kept equal to the original sync code so existing data is preserved.

Passwords are hashed with scrypt + a per-user salt. Tokens are
`base64url(payload).base64url(HMAC_SHA256(payload))` with a 30-day expiry.

The user store lives at `data/__auth_users__.json` (under the `data/` prefix so
it is covered by the function role's existing write permission).
