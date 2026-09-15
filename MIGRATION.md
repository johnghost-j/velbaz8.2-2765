# Migration — velbaz7-1022 → managed Runable app (velbaz7)

Second port. `https://github.com/johnghost-j/velbaz7-1022.git` (template 0.7.0) was copied onto a
freshly provisioned managed app scaffold (template **0.8.0**). Nothing from the repo was dropped:
524 repo files → 524 identical files in the app, plus the provisioned `.env`.

## What was verified (2026-09-11)

| Step | Result |
|------|--------|
| File-level completeness | 524/524 repo files present, byte-identical |
| Protected template files | 13/13 identical between 0.7.0 and 0.8.0 — only `__ports.cjs` changed (now reads `.runable/ports.json`), kept from the new scaffold |
| Dependency install | ok (`bun install`, isolated per-package `node_modules`) |
| Schema push to Turso | ok (`db:push` → "Changes applied") |
| Full build | ok (`bun run build` → tsc --noEmit + vite build, 2/2 packages, 1m41s) |
| Dev server | ok on port 4200 |
| Routes `/ /login /dashboard /chat /editor /plans` | all HTTP 200, rendered and screenshotted |
| `/api/health` | HTTP 200 `{"status":"ok"}` |
| Auth + DB write | `POST /api/auth/register` then `/api/auth/login` → 200, user created with 5000-credit signup bonus (test user deleted afterwards) |
| AI gateway | ok (`bun gw-check.ts` → "GATEWAY OK") |
| Lint integrity | 0 template-integrity / protected-file / asset-location violations |

## Managed infra provisioned (live in root `.env`)

New values, provisioned for this app — not the previous sandbox's keys:

`DATABASE_URL`, `DATABASE_AUTH_TOKEN` (Turso), `S3_*` (Tigris storage), `AI_GATEWAY_BASE_URL`,
`AI_GATEWAY_API_KEY`, `BETTER_AUTH_SECRET`, `AUTUMN_SECRET_KEY`, `APPLICATION_ID`, `WEBSITE_URL`,
`VITE_RUNABLE_AUTH_ISSUER`, `VITE_APPLICATION_ID`, `RUNABLE_URL`.

Ports are fixed in `.runable/ports.json` (web 4200, mobile 4300, desktop 4400).

## Optional integration keys NOT set

The code reads these; the app boots and runs without them, and the built-in `secret-store` lets
most be set at runtime instead of in `.env`:

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FIRECRAWL_API_KEY`, `OPENROUTER_API_KEY`,
`HIGGSFIELD_KEY_ID`/`HIGGSFIELD_KEY_SECRET`/`HF_*`, `DISCORD_*`, `INSTAGRAM_*`, `REDDIT_*`,
`TWITTER_*`, `TWENTY_FIRST_API_KEY`, `SECRET_STORE_KEY`, `ADMIN_EMAILS`, `BETA_*`.

Features depending on these stay inert until the key is supplied.

## Known inherited debt

`bun run lint` reports 595 errors, all pre-existing in the copied source (579 on 0.7.0; the extra
16 come from newer rules in 0.8.0). Breakdown: `no-unused-vars` (156),
`react-hooks/exhaustive-deps` (43), `max-lines` (5), misc unicorn/eslint. Build and runtime are
unaffected.

## Commands

```bash
bun run dev      # web on 4200
bun run build    # build all packages
bun run start    # pm2 production server
cd packages/web && bun run db:push
```
