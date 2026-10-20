"""The ONE feature function, used by training AND score_reading().

Contract (Common Baseline v1.0, section 6.1, "Features rule"): only values that
every Reading has may be used: total_power_w, voltage_v, hour of day and day of
week (from timestamp), the appliances_w values, and rolling stats computed from
`recent`. `sim_label` is never read here.

Note on data: appliance values come from smart plugs / sub-meters (played by the
simulator). EnergyGuard does not split one total reading into appliances.
"""
from __future__ import annotations

import math
from datetime import datetime

import numpy as np

APPLIANCES = ["ac", "fridge", "geyser", "washing_machine", "lighting", "fan", "tv", "other"]
WINDOW = 60            # max readings of history used for rolling stats
STD_FLOOR_W = 25.0     # stops tiny std from producing huge z-scores
V_NOMINAL = 230.0      # used to fill a null voltage_v

FEATURE_NAMES = (
    ["total_power_w", "voltage_v", "hour_sin", "hour_cos", "dow_sin", "dow_cos"]
    + [f"app_{a}" for a in APPLIANCES]
    + ["p_roll_mean", "p_roll_std", "p_zscore", "p_delta", "v_roll_mean", "v_dev"]
)


def _parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def build_features(reading: dict, recent: list | None = None) -> dict:
    """Return a dict of named floats for one reading.

    The dict holds every name in FEATURE_NAMES plus the helper key "hour"
    (UTC hour 0-23), which is used by the rules in inference.py only.
    `recent` = previous readings of the same meter, oldest first.
    """
    recent = list(recent or [])
    # Defensive: if the caller included the current reading as the last item, drop it.
    if recent and recent[-1].get("timestamp") == reading.get("timestamp"):
        recent = recent[:-1]
    recent = recent[-WINDOW:]

    t = _parse_ts(reading["timestamp"])
    total = float(reading["total_power_w"])
    v = reading.get("voltage_v")
    v_use = V_NOMINAL if v is None else float(v)

    rp = [float(r["total_power_w"]) for r in recent if r.get("total_power_w") is not None]
    rv = [float(r["voltage_v"]) for r in recent if r.get("voltage_v") is not None]

    if rp:
        p_mean = sum(rp) / len(rp)
        p_std = math.sqrt(sum((x - p_mean) ** 2 for x in rp) / len(rp)) if len(rp) > 1 else 0.0
        p_delta = total - rp[-1]
    else:
        p_mean, p_std, p_delta = total, 0.0, 0.0
    v_mean = sum(rv) / len(rv) if rv else V_NOMINAL

    f = {
        "total_power_w": total,
        "voltage_v": v_use,
        "hour_sin": math.sin(2 * math.pi * t.hour / 24),
        "hour_cos": math.cos(2 * math.pi * t.hour / 24),
        "dow_sin": math.sin(2 * math.pi * t.weekday() / 7),
        "dow_cos": math.cos(2 * math.pi * t.weekday() / 7),
        "p_roll_mean": p_mean,
        "p_roll_std": p_std,
        "p_zscore": (total - p_mean) / max(p_std, STD_FLOOR_W),
        "p_delta": p_delta,
        "v_roll_mean": v_mean,
        "v_dev": v_use - v_mean,
        "hour": t.hour,
    }
    ap = reading.get("appliances_w") or {}
    for a in APPLIANCES:
        f[f"app_{a}"] = float(ap.get(a) or 0.0)
    return f


def to_vector(f: dict) -> np.ndarray:
    """1 x n_features array in the fixed FEATURE_NAMES order."""
    return np.array([[f[k] for k in FEATURE_NAMES]], dtype=float)
