from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from tests.conftest import spike


def test_backfill_is_acknowledged_and_does_not_change_latest(client, reading):
    client.post("/api/v1/readings", json=reading)
    old = spike(reading, "2026-10-18T14:00:00Z")
    response = client.post("/api/v1/readings/batch?backfill=true", json={"readings": [old, old]})
    assert response.status_code == 201
    assert response.json() == {"saved": 2, "alerts_created": 2}
    for alert in client.get("/api/v1/alerts").json():
        assert alert["status"] == "acknowledged"
        assert alert["note"] == "backfill"
    assert (
        client.get("/api/v1/readings/latest?meter_id=M1").json()["timestamp"]
        == reading["timestamp"]
    )
    assert client.get("/api/v1/meters").json()[0]["last_seen"] == reading["timestamp"]


@pytest.mark.parametrize("rows", [[], [{}], [{}] * 501])
def test_invalid_batch(client, rows):
    assert (
        client.post("/api/v1/readings/batch?backfill=true", json={"readings": rows}).status_code
        == 422
    )
    assert client.get("/api/v1/meters").json() == []


def test_batch_order_and_live_batch_merge(client, reading):
    older = spike(reading)
    newer = spike(reading, "2026-10-19T14:01:00Z")
    assert (
        client.post("/api/v1/readings/batch", json={"readings": [newer, older]}).status_code == 422
    )
    result = client.post("/api/v1/readings/batch", json={"readings": [older, newer]})
    assert result.json() == {"saved": 2, "alerts_created": 1}


def test_full_500_reading_batch(client, reading):
    rows = [{**reading, "sim_label": None} for _ in range(500)]
    response = client.post("/api/v1/readings/batch?backfill=true", json={"readings": rows})
    assert response.status_code == 201
    assert response.json() == {"saved": 500, "alerts_created": 0}
    assert "energyguard_readings_total 500.0" in client.get("/metrics").text


@pytest.mark.parametrize(
    ("range_name", "count", "spacing"),
    [
        ("24h", 288, 300),
        ("7d", 168, 3600),
        ("30d", 30, 86400),
    ],
)
def test_history_bucket_sizes_empty_values_and_energy(client, reading, range_name, count, spacing):
    data = {**spike(reading), "timestamp": "2026-10-19T13:00:00Z"}
    client.post("/api/v1/readings", json=data)
    now = datetime(2026, 10, 19, 14, 0, tzinfo=UTC)
    history = client.app.state.history.get("M1", range_name, now)
    assert len(history.buckets) == count
    assert (
        history.buckets[1].bucket_start - history.buckets[0].bucket_start
    ).total_seconds() == spacing
    filled = [bucket for bucket in history.buckets if bucket.avg_power_w is not None]
    assert len(filled) == 1
    bucket = filled[0]
    assert bucket.avg_power_w == bucket.max_power_w == 4000
    duration = min(spacing, (now - bucket.bucket_start).total_seconds())
    assert bucket.energy_kwh == pytest.approx(4000 * duration / 3_600_000)
    assert sum(bucket.appliances_kwh.values()) == pytest.approx(bucket.energy_kwh)
    assert bucket.alert_count == 1
    assert history.buckets[0].model_dump(exclude={"bucket_start"}) == {
        "avg_power_w": None,
        "max_power_w": None,
        "energy_kwh": None,
        "appliances_kwh": None,
        "alert_count": None,
    }
    response = client.get(f"/api/v1/readings/history?meter_id=M1&range={range_name}")
    assert response.status_code == 200
    assert len(response.json()["buckets"]) == count


def test_scoring_recent_is_60_ordered_same_meter_without_labels(app_factory, reading):
    captured = []

    def scorer(current, recent=None):
        assert "sim_label" not in current
        assert all("sim_label" not in item for item in recent)
        captured.append(recent)
        return {
            "is_anomaly": False,
            "anomaly_type": "none",
            "score": 0.1,
            "severity": None,
            "model_version": "test",
        }

    with TestClient(app_factory(scorer=scorer)) as client:
        rows = [
            {**reading, "timestamp": f"2026-10-19T13:{index // 60:02}:{index % 60:02}Z"}
            for index in range(62)
        ]
        rows.insert(1, {**rows[0], "meter_id": "M2"})
        assert (
            client.post("/api/v1/readings/batch?backfill=true", json={"readings": rows}).status_code
            == 201
        )
    assert captured[0] == []
    assert captured[1] == []
    assert len(captured[-1]) == 60
    timestamps = [row["timestamp"] for row in captured[-1]]
    assert timestamps == sorted(timestamps)
    assert all(row["meter_id"] == "M1" for row in captured[-1])


def test_scoring_failure_rolls_back_whole_batch(app_factory, reading):
    calls = []

    def broken(current, recent=None):
        calls.append(current)
        if len(calls) == 2:
            raise RuntimeError("model failed")
        return {
            "is_anomaly": False,
            "anomaly_type": "none",
            "score": 0.1,
            "severity": None,
            "model_version": "test",
        }

    with TestClient(app_factory(scorer=broken), raise_server_exceptions=False) as client:
        response = client.post("/api/v1/readings/batch", json={"readings": [reading, reading]})
        assert response.status_code == 500
        assert response.json() == {
            "error": {"code": "internal_error", "message": "An internal server error occurred"}
        }
        assert client.get("/api/v1/meters").json() == []
        assert "energyguard_readings_total 0.0" in client.get("/metrics").text
