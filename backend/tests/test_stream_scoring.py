import asyncio
import json
from unittest.mock import patch

import pytest

from app.config import Settings
from app.schemas import AnomalyResult
from app.scoring import load_scorer
from app.stream import EventBroker
from tests.conftest import spike


def test_live_reading_merge_patch_and_backfill_events(client, reading):
    broker = client.app.state.broker
    context = broker.subscribe("M1")
    subscription = client.portal.call(context.__aenter__)
    try:
        client.post("/api/v1/readings", json=spike(reading))
        client.post("/api/v1/readings", json=spike(reading, "2026-10-19T14:01:00Z"))
        client.patch("/api/v1/alerts/1", json={"status": "acknowledged"})
        client.post("/api/v1/readings", json={**reading, "meter_id": "M2"})
        client.post("/api/v1/readings/batch?backfill=true", json={"readings": [spike(reading)]})
        events = []
        while not subscription.queue.empty():
            events.append(subscription.queue.get_nowait())
        assert [event.splitlines()[0] for event in events] == [
            "event: reading",
            "event: alert",
            "event: reading",
            "event: alert",
            "event: alert",
        ]
        payloads = [json.loads(event.split("data: ")[1]) for event in events]
        assert payloads[3]["occurrence_count"] == 2
        assert payloads[4]["status"] == "acknowledged"
        assert all(event.endswith("\n\n") for event in events)
    finally:
        client.portal.call(context.__aexit__, None, None, None)
    assert not broker.subscriptions


def test_stream_heartbeat_and_cleanup():
    class ConnectedRequest:
        async def is_disconnected(self):
            return False

    async def exercise():
        broker = EventBroker()
        stream = broker.stream("M1", ConnectedRequest())
        assert await anext(stream) == ": connected\n\n"

        async def timeout(awaitable, timeout):
            assert timeout == 15
            awaitable.close()
            raise TimeoutError

        with patch("app.stream.asyncio.wait_for", side_effect=timeout):
            assert await anext(stream) == ": heartbeat\n\n"
        await stream.aclose()
        assert not broker.subscriptions

    asyncio.run(exercise())


def test_slow_subscriber_queue_is_bounded():
    async def exercise():
        broker = EventBroker()
        async with broker.subscribe("M1") as subscription:
            for _ in range(300):
                broker.publish("M1", "reading", {})
            assert subscription.overflowed
            assert subscription.queue.qsize() == 256

    asyncio.run(exercise())


@pytest.mark.parametrize(
    ("score", "severity"), [(0.5, "low"), (0.6, "medium"), (0.8, "medium"), (0.81, "high")]
)
def test_score_boundaries(score, severity):
    result = AnomalyResult(
        is_anomaly=True,
        anomaly_type="statistical_outlier",
        score=score,
        severity=severity,
        model_version="test",
    )
    assert result.severity == severity


def test_package_import_errors_stop_startup():
    settings = Settings(ml_scorer="package", _env_file=None)
    with patch(
        "app.scoring.importlib.import_module", side_effect=FileNotFoundError("missing model")
    ):
        with pytest.raises(FileNotFoundError, match="missing model"):
            load_scorer(settings)


def test_package_adapter_uses_contract_import():
    settings = Settings(ml_scorer="package", model_path="/tmp/model.pkl", _env_file=None)
    with patch("app.scoring.importlib.import_module") as module:
        assert load_scorer(settings) is module.return_value.score_reading
        module.assert_called_once_with("energyguard_ml.inference")
