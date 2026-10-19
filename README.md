# EnergyGuard

Electricity monitoring and anomaly detection for DBIT T.E. IT, Semester V, 25IT5CEP3.
Smart plugs or sub-meters supply appliance readings. The simulator represents these devices.

Arya's backend, database, Compose stack, and Jenkins pipeline are implemented.
Other service folders are placeholders for their owners. [CONTRACT.md](CONTRACT.md) defines the shared interfaces.

## Run with Docker

Start Docker, then run:

```sh
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d --wait
```

Open [API docs](http://localhost:8000/docs). Submit a sample reading:

```sh
curl -sS http://localhost:8000/api/v1/readings \
  -H 'Content-Type: application/json' --data-binary @backend/sample-reading.json
```

The sample has a fixed timestamp. Live readings must use current UTC timestamps.
The development overlay exposes backend port 8000 and database port 5433 on localhost.
The base stack keeps both internal. PostgreSQL data persists in a Docker volume.
Startup runs database migrations. Keep exactly one backend worker for SSE and alert merging.

## Run Python locally

Use Python 3.12. From the repository root:

```sh
uv venv --python 3.12
uv pip install --python .venv/bin/python -r backend/requirements-dev.txt
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait db
```

For local Python, set `DATABASE_URL=postgresql://energyguard:energyguard@localhost:5433/energyguard` in `.env`.
Set `NOTIFIER_URL=http://localhost:8100`, then start the backend:

```sh
cd backend
../.venv/bin/alembic upgrade head
../.venv/bin/uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --workers 1
```

Restore the Docker service hostnames before running the backend in Compose.

## Check changes

```sh
.venv/bin/ruff check backend
.venv/bin/ruff format --check backend
.venv/bin/python -m pytest -q backend/tests
docker compose --profile team --profile monitoring config --quiet
```

Tests use temporary SQLite databases by default. Set `TEST_DATABASE_URL` to test PostgreSQL.
PostgreSQL tests create and remove isolated schemas, which requires permission to create schemas.
Jenkins runs lint, image builds, and tests against PostgreSQL 16. It requires a Docker-enabled agent.

See [handoff notes](docs/HANDOFF.md) to connect the model, dashboard, simulator, and notifier.
