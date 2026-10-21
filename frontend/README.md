# EnergyGuard dashboard (frontend)

Owner: Tanmay Tajane (60). Follows `CONTRACT.md` v1.0.

A web dashboard that shows how much electricity a home is using, what it will
cost this month, and when something looks wrong.

## Run it (inside WSL)

Needs Node.js 22 (`nvm use` picks it up from `.nvmrc`).

```bash
cp .env.example .env      # once, in the repo root (Vite reads VITE_API_URL from there)
cd frontend
npm install
npm run dev:all
```

That starts two things together:

| What | Where | Command on its own |
|---|---|---|
| Mock backend (fake data, same API as the real one) | http://localhost:8000/api/v1 | `npm run mock` |
| Dashboard | http://localhost:5173 | `npm run dev` |

Open http://localhost:5173 in your Windows browser. WSL forwards the port.

## What works so far

- **Overview:** live power with a "what's using power" bar per appliance (moves
  with every reading), a one-line status, today's use and cost, this month and
  the projected bill, open alerts only when there are any, and today hour by
  hour (split by appliance, grey bars for a usual day still to come)
- **Usage:** Today / This week / This month, with use, cost, average and alerts;
  stacked columns for the day and week, a calendar for the month (each day
  compared with a usual day), where the energy went, and every day as a list
- **Alerts:** filter by status, type and severity; Acknowledge / False alarm;
  export to CSV or PDF
- **Tariff engine** (`src/lib/tariff.ts`): MSEDCL-style slabs turn kWh into ₹.
  The rates there are examples: copy the real ones from a recent bill.
- Live updates over `/stream`, a pop-up for each new alert, a red count on the
  Alerts tab, a start-up animation, and a notice only when live data stops

## The mock backend

`mock/server.mjs` acts like Arya's backend so the dashboard can be built
without waiting for it. It follows the contract exactly:

- Fills 30 days of history for three meters on start, then sends a live
  reading per meter every 5 seconds
- Every endpoint from contract section 5, including the `/stream` SSE feed
- Alert merge rule, backfill rules and error format from the contract
- Faults happen on their own about every 40 minutes per meter

Force a fault for testing or a demo (mock only, not part of the contract):

```bash
curl -X POST localhost:8000/mock/inject \
  -H 'Content-Type: application/json' \
  -d '{"meter_id":"M1","type":"high_load_spike","minutes":3}'
```

Types: `high_load_spike`, `baseload_leakage`, `voltage_fluctuation`.

## Switching to the real backend

Stop the mock and start Arya's backend on port 8000. Nothing in the dashboard
changes. `VITE_API_URL` in the root `.env` points to port 8000 either way.

Things the real backend does that the dashboard handles:

- **Fresh database:** `/meters` is empty and every meter returns 404 until the
  simulator sends its first reading. The dashboard shows "Waiting for the first
  reading" and fills in by itself when data arrives.
- **Stream drops:** `/stream` doesn't replay missed events. After any reconnect
  the dashboard fetches the latest reading, history and alerts again. If no
  reading arrives for 30 seconds, the badge says "No new data" and it reconnects.
- **Alert events:** every merge sends the whole alert again. The dashboard
  replaces it by `alert_id` in place (no refetch). Only a new alert gets a pop-up.
- **Backfill alerts:** each abnormal backfill reading is its own acknowledged
  alert, so there can be hundreds. Usage counts come from the history buckets'
  `alert_count`, and the Alerts page shows 25 at a time.

## Docker

`Dockerfile` builds the app with `VITE_API_URL=/api/v1` and serves it with
nginx on port 80 (compose maps it to 3001). `nginx.conf` forwards `/api/` to
`backend:8000` with buffering off, exactly as contract section 2 says.

```bash
# from the repo root, once the backend is up
docker compose --profile team up --build -d frontend
# open http://localhost:3001
```

`ci.sh` is what Jenkins runs: lint, type-check, tests and a build on Node 22
(inside Docker, so the Jenkins agent doesn't need Node).

## Scripts

| Command | Does |
|---|---|
| `npm run dev:all` | Mock + dashboard together |
| `npm run lint` | Checks code (oxlint) |
| `npm test` | Runs the tests (Vitest) |
| `npm run build` | Type-checks and builds to `dist/` |
| `npm run preview` | Serves the built `dist/` on port 4173 |

## Folder layout

```
frontend/
├── Dockerfile             build + nginx image (and the "ci" stage)
├── nginx.conf             serves the app, forwards /api to the backend
├── ci.sh                  Jenkins checks
├── mock/server.mjs        mock backend
├── public/favicon.svg
└── src/
    ├── main.tsx           routes
    ├── index.css          design tokens (colours, type scale)
    ├── lib/energy.ts      UTC buckets -> IST hours, days, weeks, months
    ├── lib/tariff.ts      slab tariff: kWh -> ₹
    ├── app/               app shell, top navigation, meter provider
    ├── components/        small shared pieces
    ├── lib/               non-visual helpers
    └── pages/             Overview, Usage, Alerts
```

## Design rules

- White page, hairlines instead of boxes, two text tones (ink and muted).
- Geist only. Hierarchy from size and weight.
- Colour only carries meaning:
  - appliance colours in charts (`src/lib/appliances.ts`, checked for colour-blind
    separation; a colour follows its appliance, never its rank)
  - green / amber / red for normal / worth a look / act now, always with a word or icon
  - blue / grey / orange in the month calendar for less / about / more than a usual day
- Every number shown with context (its unit, a comparison, or its cost).
- Plain words: "Unusually high load", never `high_load_spike`.
