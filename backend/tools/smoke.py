"""Check the API against a running backend. Creates readings for M1 and one closed alert."""

import argparse
import json
import os
import urllib.request
from datetime import UTC, datetime
from pathlib import Path


class SmokeCheck:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def run(self):
        assert self.request("GET", "/health") == {"status": "ok"}
        sample = Path(__file__).resolve().parents[1] / "sample-reading.json"
        reading = json.loads(sample.read_text())
        reading["timestamp"] = self.now()
        saved = self.request("POST", "/readings", reading)
        assert not saved["anomaly"]["is_anomaly"]
        assert (
            self.request("GET", "/readings/latest?meter_id=M1")["reading_id"]
            == saved["reading"]["reading_id"]
        )
        reading["total_power_w"] = 4000.0
        reading["appliances_w"]["ac"] = 3359.5
        for _ in range(2):
            reading["timestamp"] = self.now()
            assert self.request("POST", "/readings", reading)["anomaly"]["is_anomaly"]
        alerts = self.request("GET", "/alerts?meter_id=M1&status=open")
        incident = next(alert for alert in alerts if alert["anomaly_type"] == "high_load_spike")
        assert incident["occurrence_count"] >= 2
        updated = self.request(
            "PATCH",
            f"/alerts/{incident['alert_id']}",
            {
                "status": "acknowledged",
                "note": "Backend smoke check",
            },
        )
        assert updated["status"] == "acknowledged"
        for range_name, count in (("24h", 288), ("7d", 168), ("30d", 30)):
            history = self.request("GET", f"/readings/history?meter_id=M1&range={range_name}")
            assert len(history["buckets"]) == count
        print("PASS: health, ingestion, latest, anomaly merge, triage, and all history ranges")

    def request(self, method, path, payload=None):
        request = urllib.request.Request(
            self.base_url + path,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={"Content-Type": "application/json"},
            method=method,
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            return json.load(response)

    @staticmethod
    def now():
        return datetime.now(UTC).isoformat().replace("+00:00", "Z")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url", default=os.getenv("BACKEND_URL", "http://localhost:8000/api/v1")
    )
    SmokeCheck(parser.parse_args().base_url).run()
