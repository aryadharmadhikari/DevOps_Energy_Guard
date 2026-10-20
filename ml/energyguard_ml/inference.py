"""score_reading(): the only function the backend calls (contract section 6.1).

- Model loads ONCE at import, from MODEL_PATH. Missing file -> error right away.
- No network, no database. Never raises for a valid reading.
- Output = AnomalyResult (section 4.2).
"""
from __future__ import annotations

import logging
import math
import os

import joblib

from .features import build_features, to_vector

log = logging.getLogger(__name__)

MODEL_PATH = os.environ.get("MODEL_PATH", "/app/ml/models/model.pkl")
if not os.path.isfile(MODEL_PATH):
    raise FileNotFoundError(f"ML model not found at MODEL_PATH={MODEL_PATH}")

_ARTIFACT = joblib.load(MODEL_PATH)
_MODEL = _ARTIFACT["model"]
_CAL = _ARTIFACT["calibration"]
_TH = _ARTIFACT["thresholds"]
_VERSION = _ARTIFACT["model_version"]

RULE_SCORE_BASE = 0.7    # a clear rule hit is at least "medium"; bigger exceedance -> up to 0.95


def _severity(score: float) -> str:
    # contract: low 0.5-0.6, medium 0.6-0.8, high above 0.8
    if score < 0.6:
        return "low"
    if score <= 0.8:
        return "medium"
    return "high"


def _rule(f: dict) -> tuple[str, float]:
    """Returns (fault type, strength 0..1). Thresholds were learned from normal data.
    Order matters: voltage, then a huge absolute load, then high use in a quiet hour,
    then a sudden jump relative to the recent past."""
    v, lo, hi = f["voltage_v"], _TH["v_lo"], _TH["v_hi"]
    if v < lo or v > hi:
        return "voltage_fluctuation", min(1.0, (lo - v if v < lo else v - hi) / 20.0)
    p = f["total_power_w"]
    if p > _TH["spike_w"]:
        return "high_load_spike", min(1.0, (p - _TH["spike_w"]) / _TH["spike_w"])
    h = f["hour"]
    limit = _TH["hour_w"].get(h, _TH["spike_w"])
    if h in _TH["low_hours"] and p > limit:
        return "baseload_leakage", min(1.0, (p - limit) / limit)
    if f["p_zscore"] > _TH["z_hi"]:
        return "high_load_spike", min(1.0, (f["p_zscore"] - _TH["z_hi"]) / _TH["z_hi"])
    return "none", 0.0


def _normal(score: float = 0.0) -> dict:
    return {"is_anomaly": False, "anomaly_type": "none", "score": score,
            "severity": None, "model_version": _VERSION}


def score_reading(reading: dict, recent: list[dict] | None = None) -> dict:
    """
    reading: one Reading (section 4.1). 'sim_label' is ignored.
    recent:  up to the last 60 Readings of the same meter, oldest first.
    returns: AnomalyResult (section 4.2).
    """
    try:
        f = build_features(reading, recent)
        raw = float(-_MODEL.score_samples(to_vector(f))[0])      # higher = more abnormal
        z = _CAL["k"] * (raw - _CAL["p"]) / _CAL["scale"]
        z = max(-50.0, min(50.0, z))
        score = 1.0 / (1.0 + math.exp(-z))

        rule, strength = _rule(f)
        if rule != "none":
            score = max(score, RULE_SCORE_BASE + 0.25 * strength)

        score = round(score, 4)
        if score < 0.5:
            return _normal(score)
        return {
            "is_anomaly": True,
            "anomaly_type": rule if rule != "none" else "statistical_outlier",
            "score": score,
            "severity": _severity(score),
            "model_version": _VERSION,
        }
    except Exception:  # never raise for the backend
        log.exception("score_reading failed; returning a normal result")
        return _normal(0.0)
