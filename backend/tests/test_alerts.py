import httpx
from fastapi.testclient import TestClient

from tests.conftest import spike


def test_merge_preserves_first_reading_and_highest_values(client, reading):
    client.post("/api/v1/readings", json=spike(reading))
    client.post("/api/v1/readings", json=spike(reading, "2026-10-19T14:06:40Z", 5000))
    client.post("/api/v1/readings", json=spike(reading, "2026-10-19T14:07:00Z", 3500))
    alerts = client.get("/api/v1/alerts?status=open&meter_id=M1").json()
    assert len(alerts) == 1
    alert = alerts[0]
    assert alert["occurrence_count"] == 3
    assert alert["reading_id"] == 1
    assert alert["timestamp"] == reading["timestamp"]
    assert alert["last_seen_at"] == "2026-10-19T14:07:00Z"
    assert alert["total_power_w"] == 4000
    assert alert["peak_power_w"] == 5000
    assert alert["severity"] == "high"
    assert alert["score"] == 0.9
    metrics = client.get("/metrics").text
    assert 'energyguard_alerts_total{anomaly_type="high_load_spike"} 1.0' in metrics


def test_expired_closed_and_different_meters_do_not_merge(client, reading):
    client.post("/api/v1/readings", json=spike(reading))
    client.post("/api/v1/readings", json=spike(reading, "2026-10-19T14:11:00Z"))
    response = client.patch("/api/v1/alerts/2", json={"status": "acknowledged", "note": "checked"})
    assert response.json()["note"] == "checked"
    client.post("/api/v1/readings", json=spike(reading, "2026-10-19T14:11:05Z"))
    client.patch("/api/v1/alerts/3", json={"status": "false_alarm"})
    client.post("/api/v1/readings", json=spike(reading, "2026-10-19T14:11:10Z"))
    client.post("/api/v1/readings", json={**spike(reading), "meter_id": "M2"})
    assert len(client.get("/api/v1/alerts").json()) == 5
    assert client.get("/api/v1/alerts?limit=1").json()[0]["alert_id"] == 4


def test_patch_errors_and_note_preservation(client, reading):
    client.post("/api/v1/readings", json=spike(reading))
    assert client.patch("/api/v1/alerts/1", json={"status": "open"}).status_code == 400
    assert client.patch("/api/v1/alerts/99", json={"status": "false_alarm"}).status_code == 404
    client.patch("/api/v1/alerts/1", json={"status": "acknowledged", "note": "keep"})
    assert client.patch("/api/v1/alerts/1", json={"status": "false_alarm"}).json()["note"] == "keep"
    result = client.patch("/api/v1/alerts/1", json={"status": "false_alarm", "note": None})
    assert result.json()["note"] is None


def test_notify_only_new_live_alerts_and_survive_notifier_failure(app_factory, reading):
    calls = []

    def unavailable(request):
        calls.append(request)
        assert request.url.path == "/notify"
        assert request.extensions["timeout"]["read"] == 2.0
        raise httpx.ConnectError("offline")

    with TestClient(app_factory(handler=unavailable)) as client:
        assert client.post("/api/v1/readings", json=spike(reading)).status_code == 201
        client.post("/api/v1/readings", json=spike(reading, "2026-10-19T14:01:00Z"))
        client.post("/api/v1/readings/batch?backfill=true", json={"readings": [spike(reading)]})
        assert len(calls) == 1
        assert len(client.get("/api/v1/alerts").json()) == 2


def test_score_and_severity_keep_maximum(app_factory, reading):
    results = iter([(0.5, "low"), (0.6, "medium"), (0.8, "medium"), (0.81, "high"), (0.5, "low")])

    def scorer(reading, recent=None):
        score, severity = next(results)
        return {
            "is_anomaly": True,
            "anomaly_type": "statistical_outlier",
            "score": score,
            "severity": severity,
            "model_version": "test",
        }

    with TestClient(app_factory(scorer=scorer)) as client:
        for minute in range(5):
            response = client.post(
                "/api/v1/readings",
                json={
                    **reading,
                    "timestamp": f"2026-10-19T14:0{minute}:00Z",
                },
            )
            assert response.status_code == 201
        alert = client.get("/api/v1/alerts").json()[0]
        assert (alert["score"], alert["severity"]) == (0.81, "high")
