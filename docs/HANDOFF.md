# Backend handoff

## Delivered by Arya

- FastAPI endpoints from contract section 5, plus `/docs`, `/openapi.json`, and `/metrics`.
- PostgreSQL tables, indexes, and an initial Alembic migration.
- Validated readings, atomic batches, and UTC responses with `Z` timestamps.
- Alert merging, peak values, status updates, and notifier calls after commit.
- SSE reading and alert events, meter filtering, and 15-second heartbeats.
- History aggregation in SQL, fixed bucket counts, and empty buckets.
- The specified ML stub and an adapter for Ameya's package.
- Docker Compose, development ports, backend image, tests, and Jenkins pipeline.

All API paths below have the `/api/v1` prefix. `/metrics` has no prefix.

| Method | Path | Use |
| --- | --- | --- |
| GET | `/health` | Database connectivity and service health |
| POST | `/readings` | Save and score one live reading |
| POST | `/readings/batch?backfill=true` | Save up to 500 readings, oldest first |
| GET | `/meters` | Discovered meters and their latest timestamps |
| GET | `/readings/latest?meter_id=M1` | Latest reading by event timestamp |
| GET | `/readings/history?meter_id=M1&range=24h` | History for `24h`, `7d`, or `30d` |
| GET | `/stream?meter_id=M1` | SSE reading and alert events |
| GET | `/alerts?meter_id=M1&status=open&limit=50` | Alerts sorted by last-seen time |
| PATCH | `/alerts/{alert_id}` | Acknowledge or mark a false alarm |

Meters appear after their first reading. An unknown meter returns HTTP 404, including on `/stream`.
The alert list accepts limits from 1 to 500. Omitted filters return all matching meters and statuses.
Omitting `note` preserves its value. Sending `note: null` clears it.
Responses include `sim_label` for contract compatibility. The dashboard must not display it.

## Harsh: connect the simulator and notifier

Inside Docker, send readings to `http://backend:8000/api/v1/readings`.
Outside Docker, use `http://localhost:8000/api/v1/readings` with the development overlay.

```sh
curl -sS -X POST http://localhost:8000/api/v1/readings \
  -H 'Content-Type: application/json' --data-binary @backend/sample-reading.json
curl -sS 'http://localhost:8000/api/v1/readings/latest?meter_id=M1'
```

The sample uses the contract's fixed timestamp. Simulator readings must use current UTC timestamps.
Include all eight appliance keys. Their sum must equal `total_power_w` within floating-point tolerance.
Numbers must be JSON numbers. Voltage can be null. Timestamps must include a timezone.
The backend rejects a simulator-supplied `reading_id` and unknown fields.

Backfill requests contain `{"readings": [...]}`. Validation or scoring failure rolls back the entire batch.
Backfill does not publish SSE events or call the notifier.

Provide `notifier/Dockerfile` serving port 8100 and the contract's `/notify` endpoint.
New live alerts trigger one call after their database transaction commits.
The backend enforces a two-second timeout. Connection errors and HTTP failures leave the alert saved.
There is no notifier retry queue. A notifier outage requires checking saved alerts.

Provide these monitoring paths before enabling the monitoring profile:

- `infra/prometheus/prometheus.yml`, scraping `backend:8000/metrics`.
- `infra/grafana/provisioning/`, provisioning a datasource at `http://prometheus:9090` and dashboards.

Metrics include `http_requests_total`, `http_request_duration_seconds`, `energyguard_readings_total`, and `energyguard_alerts_total`.
The alert counter has the `anomaly_type` label. Custom counters increment only after commit and reset on restart.
Backfill contributes to both custom counters because it saves readings and alerts.

## Ameya: install the model

Supply `ml/pyproject.toml`, `ml/energyguard_ml/inference.py`, and the model artifact.
Use scikit-learn **1.5.2** and joblib **1.4.2** to match the backend pins.
Keep model artifacts outside Git. Place the artifact at `ml/models/model.pkl` before building the image.

The Dockerfile installs `./ml` when its `pyproject.toml` exists.
For local development, run `.venv/bin/python -m pip install ./ml` if pip is installed in the environment.
With uv, run `uv pip install --python .venv/bin/python ./ml`.
Set these environment values and restart the backend:

```dotenv
ML_SCORER=package
MODEL_PATH=/app/ml/models/model.pkl
```

For local Python, replace `MODEL_PATH` with the artifact's absolute path on your laptop.
Package import and model-loading errors stop startup. The adapter does not silently fall back to the stub.

The adapter calls `score_reading(reading, recent=recent)` once per saved reading.
Both inputs exclude `sim_label`. The current reading includes its assigned `reading_id`.
Recent readings belong to the same meter, are no newer than the current reading, and are ordered oldest first.
The list contains at most 60 records and includes earlier readings from the same batch.
The backend validates AnomalyResult before committing.

## Tanmay: connect the dashboard

For Vite development, use `VITE_API_URL=http://localhost:8000/api/v1`.
The backend allows `http://localhost:5173` by default. Use comma-separated `CORS_ORIGINS` for additional origins.
The Docker build argument is `VITE_API_URL=/api/v1`. Provide `frontend/Dockerfile`, serving nginx on port 80.
Use the contract's nginx proxy block, including disabled buffering and a one-hour read timeout.

Create a reading first, then inspect the stream:

```sh
curl -N 'http://localhost:8000/api/v1/stream?meter_id=M1'
```

Listen for named `reading` and `alert` events using EventSource.
Replace an existing alert by `alert_id` on merge or status update.
Fetch latest readings and alerts on connection and reconnection. SSE does not replay missed events.
Slow clients disconnect after their queue reaches 256 events. EventSource can reconnect.

## Compose and Jenkins integration

The default stack starts `db` and `backend`. It works before other members deliver their source.
Once their Dockerfiles arrive, start the application services with:

```sh
docker compose --profile team up --build -d --wait
```

The dashboard uses port 3001. The backend and database stay internal without the development overlay.
After Harsh supplies the monitoring files, add `--profile monitoring` to start Prometheus and Grafana.
Grafana uses port 3000. Configure its credentials before external hosting.
Terraform must map the frontend to public port 80 as the contract specifies.

Jenkins needs a POSIX agent with Docker CLI, Compose v2, and access to a running Docker daemon.
Its PostgreSQL tests use isolated schemas in the disposable CI database.
The pipeline removes its containers and volumes after the run. It does not publish images or deploy.

Each teammate supplies `ci.sh` in their folder. It must run that component's lint and tests.
Use Docker or install the pinned runtime inside that script. Jenkins does not assume host Python or Node versions.
For frontend builds, use Node 22. ML code runs in the backend image with Python 3.12.
If a folder contains source without `ci.sh`, Jenkins fails. Placeholder folders print an explicit skip.
Frontend, simulator, and notifier images build when their Dockerfiles exist.

## Contract interpretation for team review

The supplied contract remains unchanged. These choices make unspecified or conflicting details explicit:

1. **Backfill and merging:** acknowledged alerts never merge, including backfill alerts.
   Each abnormal backfill reading creates an acknowledged alert with note `backfill`.
   Backfill does not modify a live open incident. Grouping backfill incidents needs a team agreement.
2. **Energy:** each populated bucket uses its mean sampled power multiplied by bucket duration.
   Divide watt-seconds by 3,600,000 to obtain kWh. Appliance energy uses the same calculation.
   This estimates consumption from regularly sampled power. It does not measure cumulative meter energy.
3. **Time window:** buckets align to UTC boundaries and include the current partial bucket.
   The partial bucket uses only elapsed time. Counts remain 288, 168, and 30.
   The first bucket is therefore an aligned boundary, rather than precisely `now - range`.
4. **Gaps:** buckets without readings contain null measurements, including null `alert_count`.
   Readings do not carry forward across missing buckets. Alerts count by their first reading's timestamp.
5. **Score boundaries:** 0.6 starts medium severity. Exactly 0.8 remains medium. Above 0.8 is high.
6. **Out-of-order input:** latest readings and meter timestamps never move backward.
   A live anomaly merges only when its timestamp is at or after the incident's last-seen time.
   Send historical data through backfill, oldest first.

## Validation record

On October 19, 2026, all 48 backend tests passed on Python 3.12 with SQLite and local PostgreSQL 18.
Lint, formatting, the scikit-learn import, and Compose configuration validation passed.
The delivered smoke script passed against a running backend with PostgreSQL.
An HTTP stream check verified reading events, alert events, status updates, and the 15-second heartbeat.
Jenkins targets PostgreSQL 16. Docker image builds and the Jenkins run need a running Docker daemon.
The supplied presentation could not be accessed. Scope and interfaces follow the pasted team contract.
