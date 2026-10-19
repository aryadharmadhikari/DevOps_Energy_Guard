EnergyGuard — Common Baseline v1.0 (Team Contract)
Oct 19, 2026 · @Someone
1. Read this first
Everyone builds their part separately, but every part must follow this document exactly. If your code matches this contract, it will plug into everyone else's code without changes.
The rules:
1. Do not change anything in this document on your own. Not a field name, not a port, not a unit.
2. Inside your own folder, use any library or approach you like, as long as what goes in and out matches this contract.
3. Need a change? Post it in the group, get a yes from every member it affects, then update this doc, bump the version (v1.0 → v1.1) and add a line to the Change log.
4. Build against the sample JSON in this doc (mocks) until the real part is ready. Never wait for a teammate to start.
5. If something here is unclear, ask in the group before guessing.
Who owns what:
Member
Owns
Folder(s)
Arya (11)
FastAPI backend, database, docker-compose, Jenkinsfile
/backend, root docker-compose.yml, Jenkinsfile
Ameya (61)
Anomaly detection model + scoring function
/ml
Tanmay (60)
React dashboard, live view, tariff engine, alert triage UI
/frontend
Harsh (56)
Meter simulator, notifier, Terraform, Prometheus/Grafana
/simulator, /notifier, /infra
Only the owner edits files in their folder. Shared root files (docker-compose.yml, Jenkinsfile, .env.example) are edited by Arya; others send him their section.
2. Shared environment
Everyone uses the same versions, repo layout, ports and env variable names, so code moves between laptops, Docker and AWS without edits.
Versions (install these exact major versions):
Tool
Version
Used by
Python
3.12
Arya, Ameya, Harsh
Node.js
22 LTS
Tanmay
PostgreSQL
16 (Docker image postgres:16)
Arya
Docker + Docker Compose
Latest Docker Desktop / Engine, Compose v2 (docker compose)
Everyone
Git
Any recent version
Everyone
Python libraries shared across parts: pydantic v2 for data models, scikit-learn 1.5.x and joblib for the model file (Ameya and Arya must use the same scikit-learn version, or model.pkl will not load). Each owner pins the rest in their own requirements.txt or package.json.
Repo layout (one GitHub repo, energyguard):
energyguard/
├── backend/        Arya    FastAPI app, DB models, Dockerfile
├── ml/             Ameya   training notebooks, energyguard_ml package, models/model.pkl
├── frontend/       Tanmay  Vite + React app, Dockerfile
├── simulator/      Harsh   simulator.py, Dockerfile
├── notifier/       Harsh   notifier.py, Dockerfile
├── infra/          Harsh   terraform/, prometheus/, grafana/
├── CONTRACT.md     everyone (copy of this doc)
├── docker-compose.yml
├── Jenkinsfile
└── .env.example
Git rules:
• main is always working. Nobody pushes to it directly.
• Work on your own branch: arya/..., ameya/..., tanmay/..., harsh/... (e.g. tanmay/live-dashboard).
• Merge through a Pull Request. Jenkins must pass before merging.
• Commit messages start with the part: backend: add alerts endpoint, frontend: live gauge.
• Never commit .env, passwords, AWS keys or large datasets. Add them to .gitignore.
Services and ports (fixed):
Service (compose name)
Owner
Port
Notes
backend
Arya
8000
FastAPI, all API under /api/v1. Runs with exactly 1 uvicorn worker (needed for the live stream)
db
Arya
5432
PostgreSQL, only backend connects
frontend
Tanmay
5173 in dev, 80 in Docker (mapped to 3001 on host)
Vite dev server in dev; nginx in Docker, which also forwards /api to the backend
simulator
Harsh
none
Only sends data, listens on nothing
notifier
Harsh
8100
Receives alerts from backend
prometheus
Harsh
9090
Scrapes backend:8000/metrics
grafana
Harsh
3000
Dashboards
Inside Docker, services call each other by compose name (http://backend:8000), never localhost.
How the browser reaches the backend (important for AWS):
The dashboard runs in the visitor's browser, so it cannot use Docker names. To make the same build work on a laptop and on AWS:
• Dev (Vite on your laptop): VITE_API_URL=http://localhost:8000/api/v1. The browser calls the backend directly; CORS allows it.
• Docker and AWS: the frontend image is built with VITE_API_URL=/api/v1 (a relative path). The browser calls its own page's address, and the frontend's nginx forwards every /api/ request to http://backend:8000/api/. No CORS is needed, and nothing changes between laptop and AWS.
• nginx must turn off buffering for the live stream, or events arrive in delayed chunks:
location /api/ {
    proxy_pass http://backend:8000/api/;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}
Only the frontend (port 3001 locally, 80 on AWS) and Grafana need to be open to the outside. The backend's port 8000 is opened only in dev.
Environment variables (.env.example, same names everywhere):
# backend
DATABASE_URL=postgresql://energyguard:energyguard@db:5432/energyguard
NOTIFIER_URL=http://notifier:8100
CORS_ORIGINS=http://localhost:5173
MODEL_PATH=/app/ml/models/model.pkl
ALERT_MERGE_MINUTES=10

# frontend (Vite only reads vars starting with VITE_; baked in at build time)
# dev:            http://localhost:8000/api/v1
# Docker / AWS:   /api/v1   (passed as a build arg in docker-compose)
VITE_API_URL=http://localhost:8000/api/v1

# simulator
BACKEND_URL=http://backend:8000/api/v1
SIM_INTERVAL_SECONDS=5
SIM_METER_COUNT=3

# notifier
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
ALERT_EMAIL_TO=
NOTIFY_COOLDOWN_SECONDS=300
No URL, port or password is ever hardcoded in code. Always read it from the environment, with the values above as defaults.
3. Data conventions
Every number carries its unit in the field name, and every time is UTC, so no part ever has to guess what a value means.
Thing
Rule
Example
JSON field names
snake_case, lowercase
total_power_w
Timestamps
UTC, ISO 8601 with Z at the end. Convert to IST only when showing on screen.
2026-10-19T14:00:00Z
Power
Watts, field ends in _w
total_power_w: 1840.5
Energy
Kilowatt-hours, field ends in _kwh
energy_kwh: 0.42
Voltage
Volts, field ends in _v
voltage_v: 231.2
Meter ID
String M + number
"M1", "M2", "M3"
Numbers
Plain JSON numbers, never strings
1840.5, not "1840.5"
Missing value
null, never 0, "" or "NA"
voltage_v: null
Appliance keys (fixed list, same spelling everywhere):
ac, fridge, geyser, washing_machine, lighting, fan, tv, other
Every reading includes all eight keys (use 0 when the appliance is off). total_power_w must equal the sum of the eight values.
Where per-appliance data comes from: a normal smart meter only reports the total. Our system assumes each appliance has a smart plug or sub-meter, and the simulator plays that role. EnergyGuard does not split one total reading into appliances. Describe it this way everywhere (code comments, README, report).
Anomaly types (fixed list):
Value
Meaning
Who produces it
none
Normal reading
ML
baseload_leakage
Usage stays high when it should be low (e.g. at night)
ML, simulator fault
high_load_spike
Sudden or sustained very high load
ML, simulator fault
voltage_fluctuation
Voltage outside the normal band
ML, simulator fault
statistical_outlier
Unusual by the model but not one of the above
ML only
Alert status (fixed list): open, acknowledged, false_alarm.
Severity (fixed list): low, medium, high.
4. Data objects
These five JSON shapes are the only data that moves between parts. Copy them exactly into your mocks and models.
4.1 Reading — what the simulator sends; the backend adds reading_id when saving.
{
  "reading_id": 10234,
  "meter_id": "M1",
  "timestamp": "2026-10-19T14:00:05Z",
  "total_power_w": 1840.5,
  "voltage_v": 231.2,
  "appliances_w": {
    "ac": 1200.0, "fridge": 150.0, "geyser": 0.0, "washing_machine": 0.0,
    "lighting": 80.5, "fan": 140.0, "tv": 120.0, "other": 150.0
  },
  "sim_label": "normal"
}
• reading_id: integer, set by backend only. The simulator does not send it.
• sim_label: optional, only from the simulator. Values: normal or one of the anomaly types. It is the true answer, used by Ameya to test the model. The frontend never shows it, and the model never reads it when scoring.
4.2 AnomalyResult — what Ameya's score_reading() returns.
{
  "is_anomaly": true,
  "anomaly_type": "high_load_spike",
  "score": 0.91,
  "severity": "high",
  "model_version": "iforest-v1"
}
• score: 0.0 to 1.0, higher means more abnormal.
• is_anomaly is true only when score ≥ 0.5. Below 0.5 it is always false.
• severity: low if score is 0.5–0.6, medium if 0.6–0.8, high if above 0.8.
• When is_anomaly is false: anomaly_type is none and severity is null.
4.3 Alert — created or updated by the backend whenever is_anomaly is true (merge rule below).
{
  "alert_id": 42,
  "meter_id": "M1",
  "reading_id": 10234,
  "timestamp": "2026-10-19T14:00:05Z",
  "last_seen_at": "2026-10-19T14:06:40Z",
  "occurrence_count": 80,
  "anomaly_type": "high_load_spike",
  "severity": "high",
  "score": 0.91,
  "total_power_w": 1840.5,
  "peak_power_w": 2410.0,
  "message": "High load spike on M1: 1840.5 W",
  "status": "open",
  "note": null,
  "created_at": "2026-10-19T14:00:06Z",
  "updated_at": "2026-10-19T14:06:41Z"
}
• reading_id, timestamp, total_power_w: the first reading that started the alert.
• last_seen_at, occurrence_count, peak_power_w: updated as more abnormal readings arrive.
• severity and score always show the highest value seen so far.
Merge rule (stops alert floods): when a reading is abnormal, the backend looks for an open alert with the same meter_id and anomaly_type whose last_seen_at is within ALERT_MERGE_MINUTES (default 10).
• Found → update that alert. No new alert, no email.
• Not found → create a new alert and call the notifier.
• Alerts marked acknowledged or false_alarm are never merged into. If the problem continues, a new alert opens.
4.4 History bucket — one point in a history chart (backend does the grouping).
{
  "bucket_start": "2026-10-19T13:00:00Z",
  "avg_power_w": 1320.4,
  "max_power_w": 2410.0,
  "energy_kwh": 1.32,
  "appliances_kwh": {
    "ac": 0.80, "fridge": 0.15, "geyser": 0.0, "washing_machine": 0.0,
    "lighting": 0.07, "fan": 0.12, "tv": 0.08, "other": 0.10
  },
  "alert_count": 2
}
Range
Bucket size
Points returned
24h
5 minutes
288
7d
1 hour
168
30d
1 day
30
Buckets with no data are still returned, with null values, so charts keep even spacing.
4.5 Meter
{ "meter_id": "M1", "name": "Home 1", "last_seen": "2026-10-19T14:00:05Z" }
5. Backend API (owner: Arya)
All endpoints live under http://<host>:8000/api/v1 and send and receive JSON. These are the only doors into the backend; nobody touches the database directly.
Method
Path
Called by
Request
Response
GET
/health
Jenkins, Docker, Terraform checks
—
{"status": "ok"}
POST
/readings
Simulator (live)
Reading (4.1) without reading_id
201 + {"reading": Reading, "anomaly": AnomalyResult}
POST
/readings/batch?backfill=true
Simulator (backfill only)
{"readings": [Reading, ...]}, up to 500, oldest first
201 + {"saved": 500, "alerts_created": 3}
GET
/meters
Frontend
—
[Meter, ...]
GET
/readings/latest?meter_id=M1
Frontend
—
Reading
GET
/readings/history?meter_id=M1&range=24h
Frontend
range = 24h, 7d or 30d
{"meter_id", "range", "buckets": [HistoryBucket, ...]}
GET
/stream?meter_id=M1
Frontend
—
Server-Sent Events (below)
GET
/alerts?meter_id=M1&status=open&limit=50
Frontend
All filters optional, sorted by last_seen_at, newest first
[Alert, ...]
PATCH
/alerts/{alert_id}
Frontend
{"status": "acknowledged" or "false_alarm", "note": "optional text"}
Updated Alert
GET
/metrics (no /api/v1 prefix)
Prometheus
—
Prometheus text format
Backfill mode (?backfill=true): readings are saved and scored, and alerts follow the merge rule, but backfill alerts are saved with status acknowledged and note backfill. No emails, no stream events. This fills the 7-day and 30-day charts without flooding the triage screen or anyone's inbox.
Live stream (SSE) format:
The backend sends two event types on /stream. Each data line is one JSON object.
event: reading
data: {"reading": {...Reading...}, "anomaly": {...AnomalyResult...}}

event: alert
data: {...Alert...}

: heartbeat
• A reading event goes out for every live (non-backfill) reading of that meter.
• An alert event goes out every time an alert is created or updated (merge, acknowledge, false alarm). The frontend replaces any alert it already shows that has the same alert_id.
• A : heartbeat comment is sent every 15 seconds so the connection doesn't time out.
• The backend runs with 1 uvicorn worker, so every connected browser gets every event. More workers would need Redis; that is out of scope for the prototype.
Errors (same shape for every endpoint):
{ "error": { "code": "meter_not_found", "message": "No meter with id M9" } }
HTTP code
When
400
Bad request (wrong range value, bad status)
404
Meter or alert not found
422
Reading JSON doesn't match 4.1
500
Backend bug
CORS: backend allows the origins in CORS_ORIGINS, methods GET, POST, PATCH.
Metrics the backend exposes at /metrics (for Harsh's Grafana): request count and latency per endpoint, energyguard_readings_total, energyguard_alerts_total (labelled by anomaly_type). Using prometheus-fastapi-instrumentator covers the first two automatically.
6. Other interfaces
The ML model plugs in as one Python function, the notifier as one HTTP endpoint, and the simulator only ever calls POST /readings.
6.1 ML scoring function (owner: Ameya, used by Arya)
File: ml/energyguard_ml/inference.py. The ml folder has a pyproject.toml so the backend can install it with pip install ./ml.
def score_reading(reading: dict, recent: list[dict] | None = None) -> dict:
    """
    reading: one Reading (section 4.1). Ignore 'sim_label'.
    recent:  up to the last 60 Readings of the same meter, oldest first
             (backend passes these; used for rolling averages / z-score).
    returns: AnomalyResult (section 4.2).
    """
• The model loads once when the module is imported, from the path in MODEL_PATH. If the file is missing, it raises an error right away.
• No network calls and no database access inside the function. It should take under 50 ms.
• It never raises for a valid reading. If recent is empty or None, it still returns a result.
• Features rule: the model may only use values that every Reading has: total_power_w, voltage_v, hour of day and day of week (from timestamp), the appliances_w values, and rolling stats computed from recent (mean, std, z-score, change from previous). Public datasets are first converted into these same features before training. If a public dataset lacks voltage or appliance columns, train on the features it has and fill the rest from simulator data. Never train on a column our Reading doesn't have.
• The feature code lives in one function used by both training and score_reading(), so they can never drift apart.
Until the real model is ready, Arya uses this stub (same signature, same output):
def score_reading(reading, recent=None):
    spike = reading["total_power_w"] > 3000
    return {
        "is_anomaly": spike,
        "anomaly_type": "high_load_spike" if spike else "none",
        "score": 0.9 if spike else 0.1,
        "severity": "high" if spike else None,
        "model_version": "stub",
    }
6.2 Notifier (owner: Harsh, called by Arya's backend)
Method
Path
Request
Response
POST
/notify
Alert (section 4.3)
202 + {"queued": true} or {"queued": false, "reason": "cooldown"}
GET
/health
—
{"status": "ok"}
• The backend calls NOTIFIER_URL/notify only when a new alert is created (not on merges, not in backfill), with a 2-second timeout. If the notifier is down, the backend logs it and carries on. Alerts are never lost because they are already saved in the database.
• Anti-spam (second safety layer): the notifier sends at most one email per meter_id + anomaly_type within NOTIFY_COOLDOWN_SECONDS.
• Email subject format: [EnergyGuard] HIGH — high_load_spike on M1.
6.3 Simulator (owner: Harsh)
• Every SIM_INTERVAL_SECONDS, it sends one Reading per meter (M1 to M<SIM_METER_COUNT>) to BACKEND_URL/readings, with the current UTC time as timestamp.
• It follows a realistic daily pattern (low at night, peaks morning and evening, AC heavier in the afternoon) and fills sim_label.
• If the backend is down, it retries every 5 seconds and never crashes.
• Demo flag: python simulator.py --inject high_load_spike --meter M1 forces a fault right now, so the alert can be shown live.
• Backfill flag: python simulator.py --backfill-days 30 generates past readings at one per minute per meter (with occasional faults) and sends them oldest first to POST /readings/batch?backfill=true in batches of 500. Run it once on a fresh database, before starting live mode, so the 7-day and 30-day charts have data.
• Training data flag: python simulator.py --export-csv data/sim_30d.csv --days 30 writes readings to a CSV (one column per field, appliance values as appliances_w.ac etc.) for Ameya. It sends nothing to the backend.
7. Getting started and connecting the parts
Each member sets up the items below on day one, builds against mocks, and then the parts are connected one pair at a time in the order shown.
Day-one setup (everyone):
[ ] Clone the energyguard repo and create your own branch
[ ] Install the versions in section 2
[ ] Copy .env.example to .env (never commit .env)
[ ] Read sections 3 to 6 fully once
What each member builds against until the real part is ready:
Member
Mock / stub to use
Your part is ready to connect when
Arya
Stub score_reading() from 6.1; send test readings with Postman or curl
Every endpoint in section 5 returns the documented shape, the merge rule works, and /docs (FastAPI's auto page) matches this doc
Ameya
CSV datasets + simulator CSV export (6.3)
from energyguard_ml.inference import score_reading works in a fresh environment and returns 4.2 for any 4.1 reading, using only the allowed features
Tanmay
Mock server returning the JSON from section 4, plus a small script that sends SSE events in the section 5 format (including alert updates)
Switching VITE_API_URL from the mock to the real backend needs no code change, and the Docker build works behind nginx with /api/v1
Harsh
Simulator posts to a dummy endpoint or prints to console; notifier tested with sample Alert JSON via curl
Simulator output passes POST /readings and /readings/batch without 422; notifier sends one test email
Integration order (connect one pair at a time, test, then move on):
1. Simulator → Backend. Readings arrive and are saved. Check: GET /readings/latest?meter_id=M1 changes every 5 seconds, and --backfill-days 30 fills the 30-day history.
2. Backend → ML model. Stub replaced by Ameya's real package. Check: simulator.py --inject high_load_spike creates one alert, and further abnormal readings increase its occurrence_count instead of creating new alerts.
3. Backend → Frontend. Dashboard on real data. Check: the live gauge moves, and the injected alert appears and updates without a page reload.
4. Backend → Notifier. Check: the injected alert sends exactly one email; merges and backfill send none.
5. Everything in Docker. Check: docker compose up on a fresh laptop runs all services, the dashboard at http://localhost:3001 works through nginx, and steps 1–4 still pass.
6. Jenkins. Check: a PR runs lint + tests + image build for every part and turns green.
7. Prometheus + Grafana. Check: Grafana shows API latency, request rate and alert count live.
8. AWS via Terraform. Check: terraform apply brings the stack up, and the dashboard opens and streams live from the public IP.
Weekly sync (15 minutes): each member answers three questions. What works now? Does my part still match this contract? What do I need from someone else?
8. Change log
Every agreed change gets one line here, newest first, and bumps the version in the title.