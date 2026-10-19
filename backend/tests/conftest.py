import os
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.config import Settings
from app.main import create_app

BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture
def database_url(tmp_path, monkeypatch):
    postgres = os.getenv("TEST_DATABASE_URL")
    admin = None
    schema = "eg_test_" + uuid4().hex
    if postgres:
        postgres = postgres.replace("postgresql://", "postgresql+psycopg://", 1)
        admin = create_engine(postgres)
        with admin.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        url = make_url(postgres).update_query_dict({"options": f"-csearch_path={schema}"})
        url = url.render_as_string(hide_password=False)
    else:
        url = f"sqlite:///{tmp_path / 'test.db'}"
    monkeypatch.setenv("DATABASE_URL", url)
    command.upgrade(Config(str(BACKEND / "alembic.ini")), "head")
    yield url
    if admin:
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


@pytest.fixture
def app_factory(database_url):
    def build(scorer=None, handler=None):
        settings = Settings(database_url=database_url, ml_scorer="stub", _env_file=None)
        handler = handler or (lambda request: httpx.Response(202, json={"queued": True}))
        return create_app(settings, scorer=scorer, notifier_transport=httpx.MockTransport(handler))

    return build


@pytest.fixture
def client(app_factory):
    with TestClient(app_factory()) as client:
        yield client


@pytest.fixture
def reading():
    return {
        "meter_id": "M1",
        "timestamp": "2026-10-19T14:00:05Z",
        "total_power_w": 1840.5,
        "voltage_v": 231.2,
        "appliances_w": {
            "ac": 1200.0,
            "fridge": 150.0,
            "geyser": 0.0,
            "washing_machine": 0.0,
            "lighting": 80.5,
            "fan": 140.0,
            "tv": 120.0,
            "other": 150.0,
        },
        "sim_label": "normal",
    }


def spike(reading, timestamp="2026-10-19T14:00:05Z", power=4000.0):
    return {
        **reading,
        "timestamp": timestamp,
        "total_power_w": power,
        "appliances_w": {**reading["appliances_w"], "ac": 1200.0 + power - 1840.5},
    }
