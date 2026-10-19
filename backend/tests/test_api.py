import copy
from concurrent.futures import ThreadPoolExecutor

import pytest

from tests.conftest import spike


def test_health_ingest_latest_meters_and_metrics(client, reading):
    assert client.get("/api/v1/health").json() == {"status": "ok"}
    response = client.post("/api/v1/readings", json=reading)
    assert response.status_code == 201
    saved = response.json()["reading"]
    assert saved == {**reading, "reading_id": 1}
    assert response.json()["anomaly"] == {
        "is_anomaly": False,
        "anomaly_type": "none",
        "score": 0.1,
        "severity": None,
        "model_version": "stub",
    }
    assert client.get("/api/v1/readings/latest?meter_id=M1").json() == saved
    assert client.get("/api/v1/meters").json() == [
        {"meter_id": "M1", "name": "Home 1", "last_seen": reading["timestamp"]},
    ]
    metrics = client.get("/metrics").text
    assert "energyguard_readings_total 1.0" in metrics
    assert "http_request_duration_seconds" in metrics
    assert "http_requests_total" in metrics


@pytest.mark.parametrize(
    "change",
    [
        {"total_power_w": 1},
        {"total_power_w": "1840.5"},
        {"voltage_v": -1},
        {"meter_id": "home1"},
        {"meter_id": "M0"},
        {"reading_id": 5},
        {"timestamp": "2026-10-19T14:00:05"},
        {"timestamp": "not-a-date"},
        {"sim_label": "unknown"},
    ],
)
def test_invalid_readings_have_contract_error(client, reading, change):
    response = client.post("/api/v1/readings", json={**reading, **change})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert client.get("/api/v1/meters").json() == []


def test_all_appliances_required_and_nonnegative(client, reading):
    invalid = copy.deepcopy(reading)
    del invalid["appliances_w"]["other"]
    assert client.post("/api/v1/readings", json=invalid).status_code == 422
    invalid["appliances_w"]["other"] = -1
    assert client.post("/api/v1/readings", json=invalid).status_code == 422


def test_null_voltage_and_utc_conversion(client, reading):
    reading.update(timestamp="2026-10-19T19:30:05+05:30", voltage_v=None)
    result = client.post("/api/v1/readings", json=reading).json()["reading"]
    assert result["timestamp"] == "2026-10-19T14:00:05Z"
    assert result["voltage_v"] is None


@pytest.mark.parametrize(
    ("path", "status", "code"),
    [
        ("/api/v1/readings/latest?meter_id=M9", 404, "meter_not_found"),
        ("/api/v1/readings/history?meter_id=M9", 404, "meter_not_found"),
        ("/api/v1/stream?meter_id=M9", 404, "meter_not_found"),
        ("/api/v1/alerts?meter_id=M9", 404, "meter_not_found"),
        ("/api/v1/readings/history?meter_id=M1&range=1d", 400, "invalid_range"),
        ("/api/v1/alerts?status=closed", 400, "invalid_status"),
        ("/api/v1/unknown", 404, "http_error"),
    ],
)
def test_error_envelopes(client, path, status, code):
    response = client.get(path)
    assert response.status_code == status
    assert response.json()["error"]["code"] == code


def test_cors(client):
    response = client.options(
        "/api/v1/readings",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_concurrent_ingestion_has_one_open_alert(client, reading):
    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(
            pool.map(
                lambda _: client.post("/api/v1/readings", json=spike(reading)),
                range(12),
            )
        )
    assert all(response.status_code == 201 for response in responses)
    alerts = client.get("/api/v1/alerts").json()
    assert len(alerts) == 1
    assert alerts[0]["occurrence_count"] == 12
