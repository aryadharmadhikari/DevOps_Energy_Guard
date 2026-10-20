"""Contract tests for score_reading() (Common Baseline v1.0, sections 4.2 and 6.1).

Run from the ml/ folder:  pytest tests
If models/model.pkl does not exist yet, a small model is trained on synthetic
data into a temp folder, so these tests also pass on a fresh checkout / CI.
"""
import copy
import os
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _ensure_model() -> str:
    env = os.environ.get("MODEL_PATH")
    if env and os.path.isfile(env):
        return env
    real = ROOT / "models" / "model.pkl"
    if real.is_file():
        return str(real)
    from energyguard_ml.synthetic import make_synthetic
    from energyguard_ml.training import fit_artifact, save_artifact
    df = make_synthetic(days=4, meters=1, interval_s=60, seed=1)
    df["source"] = "synthetic"
    path = Path(tempfile.mkdtemp()) / "model.pkl"
    save_artifact(fit_artifact(df, n_estimators=50), path)
    return str(path)


os.environ["MODEL_PATH"] = _ensure_model()
from energyguard_ml.inference import score_reading  # noqa: E402  (after MODEL_PATH is set)

READING = {
    "meter_id": "M1", "timestamp": "2026-10-19T14:00:05Z",
    "total_power_w": 1840.5, "voltage_v": 231.2,
    "appliances_w": {"ac": 1200.0, "fridge": 150.0, "geyser": 0.0, "washing_machine": 0.0,
                     "lighting": 80.5, "fan": 140.0, "tv": 120.0, "other": 150.0},
    "sim_label": "normal",
}
KEYS = {"is_anomaly", "anomaly_type", "score", "severity", "model_version"}
TYPES = {"none", "baseload_leakage", "high_load_spike", "voltage_fluctuation", "statistical_outlier"}


def _history(n=30, step_s=60):
    out = []
    for i in range(n):
        r = copy.deepcopy(READING)
        r["timestamp"] = f"2026-10-19T13:{(30 + i * step_s // 60) % 60:02d}:05Z"
        r["total_power_w"] = 1800.0 + (i % 5) * 10
        out.append(r)
    return out


def _check_shape(out):
    assert set(out) == KEYS
    assert isinstance(out["is_anomaly"], bool)
    assert out["anomaly_type"] in TYPES
    assert isinstance(out["score"], float) and 0.0 <= out["score"] <= 1.0
    assert isinstance(out["model_version"], str) and out["model_version"]
    if out["is_anomaly"]:
        assert out["anomaly_type"] != "none" and out["score"] >= 0.5
        assert out["severity"] in {"low", "medium", "high"}
        s = out["score"]
        assert out["severity"] == ("low" if s < 0.6 else "medium" if s <= 0.8 else "high")
    else:
        assert out["anomaly_type"] == "none" and out["severity"] is None and out["score"] < 0.5


def test_shape_with_no_history():
    for recent in (None, []):
        _check_shape(score_reading(READING, recent))


def test_shape_with_history():
    _check_shape(score_reading(READING, _history(60)))


def test_null_voltage_does_not_raise():
    r = {**READING, "voltage_v": None}
    _check_shape(score_reading(r, _history(10)))


def test_null_voltage_in_history():
    h = _history(10)
    h[3]["voltage_v"] = None
    _check_shape(score_reading(READING, h))


def test_sim_label_is_ignored():
    a = score_reading({**READING, "sim_label": "normal"}, _history(20))
    b = score_reading({**READING, "sim_label": "high_load_spike"}, _history(20))
    assert a == b


def test_current_reading_in_recent_is_harmless():
    h = _history(20)
    assert score_reading(READING, h) == score_reading(READING, h + [copy.deepcopy(READING)])


def test_bad_input_never_raises():
    out = score_reading({"timestamp": "garbage"}, None)
    assert set(out) == KEYS


def test_voltage_fault_detected():
    out = score_reading({**READING, "voltage_v": 170.0}, _history(20))
    assert out["is_anomaly"] and out["anomaly_type"] == "voltage_fluctuation"
    _check_shape(out)


def test_huge_load_is_anomaly():
    r = {**READING, "total_power_w": 12000.0}
    r["appliances_w"] = {**READING["appliances_w"], "other": 10500.0}
    out = score_reading(r, _history(20))
    assert out["is_anomaly"] and out["anomaly_type"] == "high_load_spike"


def test_latency_under_50ms():
    h = _history(60)
    score_reading(READING, h)                       # warm-up
    times = []
    for _ in range(50):
        t0 = time.perf_counter()
        score_reading(READING, h)
        times.append((time.perf_counter() - t0) * 1000)
    times.sort()
    assert times[int(0.95 * len(times))] < 50.0
