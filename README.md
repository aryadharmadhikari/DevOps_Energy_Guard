# EnergyGuard

Web-based electricity consumption monitoring and anomaly detection for DBIT T.E. IT, Semester V, 25IT5CEP3.

Meters report total power. Smart plugs or sub-meters supply appliance readings, which the simulator represents.
EnergyGuard does not infer appliance readings from total power.

Arya's backend is implemented. The other service folders contain placeholders for their owners.
[CONTRACT.md](CONTRACT.md) preserves the supplied team contract without edits.

| Owner | Scope |
| --- | --- |
| Arya Dharmadhikari (11) | `backend/`, Compose, Jenkins, shared environment |
| Ameya Tamanekar (61) | `ml/`, model training and inference |
| Tanmay Tajane (60) | `frontend/`, dashboard, tariff engine, alert triage |
| Harsh Singh (56) | `simulator/`, `notifier/`, `infra/`, monitoring, Terraform |

## Start Arya's services

Install Docker Engine or Desktop with Compose v2. Start the Docker daemon.

```sh
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d --wait
python3 backend/tools/smoke.py
```

The smoke check uses the default ML stub. It creates M1 readings and acknowledges its test alert.
Open [API docs](http://localhost:8000/docs) or [health](http://localhost:8000/api/v1/health).
The database persists in the `postgres_data` volume. Startup applies Alembic migrations before the API starts.

The base Compose file keeps the backend and database internal.
The development overlay publishes ports 8000 and 5432 on localhost.

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
```

## Run Python locally

Use Python 3.12. These commands use `uv` to select the exact major version.
Run them from the repository root.

```sh
uv venv --python 3.12
uv pip install --python .venv/bin/python -r backend/requirements-dev.txt
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait db
```

For local Python, change `DATABASE_URL` in `.env` to:

```dotenv
DATABASE_URL=postgresql://energyguard:energyguard@localhost:5432/energyguard
NOTIFIER_URL=http://localhost:8100
```

Then start the backend:

```sh
cd backend
../.venv/bin/alembic upgrade head
../.venv/bin/uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --workers 1
```

Restore the `db` hostname before running the backend inside Docker.
Keep exactly one worker. The live event broker and write lock run in one process.

## Verify changes

From the repository root:

```sh
.venv/bin/ruff check backend
.venv/bin/ruff format --check backend
.venv/bin/python -m pytest -q backend/tests
docker compose --profile team --profile monitoring config --quiet
```

Tests use a temporary SQLite database by default. To test PostgreSQL, provide a test database URL:

```sh
TEST_DATABASE_URL=postgresql://energyguard:energyguard@localhost:5432/energyguard \
  .venv/bin/python -m pytest -q backend/tests
```

PostgreSQL tests create a unique schema per test and remove that schema afterward.
They require permission to create schemas. They do not reset application tables.

Jenkins runs lint, formatting, tests, a backend image build, and integration tests against PostgreSQL 16.
It checks teammate services when their source and CI scripts arrive. See [handoff notes](docs/HANDOFF.md).

## Connect the team

Use [docs/HANDOFF.md](docs/HANDOFF.md) for service setup, ML installation, SSE, examples, and contract interpretation.
Use feature branches named `arya/...`, `ameya/...`, `tanmay/...`, or `harsh/...`.
Open a pull request for `main`. Require Jenkins before merge.
Use one-line conventional commits, such as `feat(backend): add reading ingestion`.

The ML stub flags total power above 3000 W. It does not implement Ameya's model.
The full dashboard, emails, simulator, and AWS deployment require the owners' implementations.
