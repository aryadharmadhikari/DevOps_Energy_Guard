# Team handoff

[CONTRACT.md](../CONTRACT.md) defines the payloads, endpoints, ports, and ownership.
The backend implements section 5. `/docs` provides interactive requests and response schemas.

## Harsh: simulator, notifier, monitoring

- Docker API: `http://backend:8000/api/v1`. Local API: `http://localhost:8000/api/v1` with the development overlay.
- Send live readings to `/readings`. Include all eight appliance keys with a sum equal to `total_power_w`.
- Send historical readings oldest first to `/readings/batch?backfill=true`, at most 500 per request.
- A failed batch rolls back completely. Backfill sends no email or stream events.
- Provide `notifier/Dockerfile` serving `/notify` on port 8100.
- New live alerts trigger notifier calls after commit. Merges do not. Failures are logged with a two-second timeout.
- Supply `infra/prometheus/prometheus.yml` and `infra/grafana/provisioning/` before enabling monitoring.
- Prometheus scrapes `backend:8000/metrics`. Grafana's datasource uses `http://prometheus:9090`.

Metrics include request counts, request latency, `energyguard_readings_total`, and `energyguard_alerts_total` labeled by `anomaly_type`.
Counters include backfill and reset on restart.

## Ameya: model

Supply `ml/pyproject.toml`, `ml/energyguard_ml/inference.py`, and `ml/models/model.pkl`.
Match backend pins: scikit-learn 1.5.2 and joblib 1.4.2. Model artifacts stay outside Git.
The Dockerfile installs the package when present. Locally, use `uv pip install --python .venv/bin/python ./ml`.

Set `ML_SCORER=package` and restart. `MODEL_PATH` defaults to `/app/ml/models/model.pkl` inside Docker.
For local Python, set an absolute artifact path. Package or model import failures stop startup.
The default `ML_SCORER=stub` uses the contract's temporary rule: power above 3000 W is anomalous.

The adapter passes the current reading and up to 60 earlier readings from the same meter, oldest first.
Both inputs exclude `sim_label`. Results must match AnomalyResult, including score and severity boundaries.

## Tanmay: dashboard

Use `VITE_API_URL=http://localhost:8000/api/v1` for Vite development.
Compose builds with `VITE_API_URL=/api/v1`. Supply `frontend/Dockerfile`, serving nginx on port 80.
Use the contract's nginx proxy configuration, including disabled SSE buffering.

Meters appear after their first reading. Unknown meters return 404.
Listen for named `reading` and `alert` events on `/stream?meter_id=M1`.
Replace alerts by `alert_id` on merge or status updates. Fetch snapshots on connection and reconnection.
SSE sends heartbeats every 15 seconds. It does not replay events and disconnects slow clients after 256 queued events.
Do not display `sim_label`. Omitted PATCH notes preserve their value. Explicit null clears them.

## Compose and CI

The default stack starts the backend and database. After teammate Dockerfiles arrive:

```sh
docker compose --profile team up --build -d --wait
```

The dashboard uses port 3001. Add `--profile monitoring` after Harsh supplies monitoring files.
Grafana uses port 3000. AWS infrastructure must expose the frontend on port 80.

Each teammate provides `ci.sh` for their component's lint and tests, using its required runtime or Docker.
Jenkins skips placeholder folders and fails if source arrives without its checks.
Frontend, simulator, and notifier images build when their Dockerfiles exist.

## Contract details for team review

- Acknowledged alerts never merge. Each abnormal backfill reading creates an acknowledged alert with note `backfill`, without modifying live incidents.
- Energy estimates use mean sampled power times bucket duration, divided by 3,600,000. Appliance energy uses the same calculation.
- Buckets align to UTC boundaries, include the current partial bucket, and use elapsed duration for that partial bucket.
- Buckets without readings contain null values. Alerts count by their first reading's timestamp.
- A score of 0.6 starts medium severity. Exactly 0.8 remains medium. Above 0.8 is high.
- Latest reading timestamps never move backward. Live anomalies merge only at or after the incident's last-seen time.

Docker builds and Jenkins execution require a running Docker daemon and remain unverified locally.
