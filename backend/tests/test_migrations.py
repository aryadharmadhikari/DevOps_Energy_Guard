from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from tests.conftest import BACKEND


def test_migration_matches_models(database_url):
    command.check(Config(str(BACKEND / "alembic.ini")))


def test_restart_preserves_readings_and_alerts(app_factory, reading):
    from tests.conftest import spike

    with TestClient(app_factory()) as first:
        assert first.post("/api/v1/readings", json=spike(reading)).status_code == 201
    with TestClient(app_factory()) as restarted:
        assert restarted.get("/api/v1/readings/latest?meter_id=M1").json()["reading_id"] == 1
        assert len(restarted.get("/api/v1/alerts?status=open").json()) == 1
