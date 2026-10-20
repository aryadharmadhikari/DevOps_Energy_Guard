"""Evaluate score_reading() against the simulator's true labels (sim_label)."""
from __future__ import annotations

import importlib
import os
import time

import numpy as np
import pandas as pd
from sklearn.metrics import classification_report, confusion_matrix

from .features import WINDOW
from .training import _group_keys, to_readings

TYPES = ["none", "baseload_leakage", "high_load_spike", "voltage_fluctuation", "statistical_outlier"]


def load_inference(model_path):
    """Import (or re-import) energyguard_ml.inference pointing at `model_path`."""
    os.environ["MODEL_PATH"] = str(model_path)
    import energyguard_ml.inference as inf
    return importlib.reload(inf)


def run_scoring(test_df: pd.DataFrame, model_path) -> pd.DataFrame:
    inf = load_inference(model_path)
    rows, lat = [], []
    for _, g in test_df.groupby(_group_keys(test_df), sort=False):
        recs = to_readings(g)
        for i, r in enumerate(recs):
            t0 = time.perf_counter()
            out = inf.score_reading(r, recs[max(0, i - WINDOW):i])
            lat.append((time.perf_counter() - t0) * 1000.0)
            rows.append((r["meter_id"], r["timestamp"], r["sim_label"],
                         out["anomaly_type"], out["is_anomaly"], out["score"], out["severity"]))
    res = pd.DataFrame(rows, columns=["meter_id", "timestamp", "sim_label", "pred_type",
                                      "is_anomaly", "score", "severity"])
    res["true_type"] = res["sim_label"].replace({"normal": "none"})
    res["latency_ms"] = lat
    res["timestamp"] = pd.to_datetime(res["timestamp"], utc=True)
    return res


def summarize(res: pd.DataFrame) -> dict:
    true_pos = res["true_type"] != "none"
    tp = int((true_pos & res["is_anomaly"]).sum())
    fp = int((~true_pos & res["is_anomaly"]).sum())
    fn = int((true_pos & ~res["is_anomaly"]).sum())
    precision = tp / (tp + fp) if tp + fp else float("nan")
    recall = tp / (tp + fn) if tp + fn else float("nan")
    f1 = 2 * precision * recall / (precision + recall) if tp else 0.0

    # episode recall: a fault episode counts as caught if ANY reading in it was flagged
    caught, total_ep = 0, 0
    for _, g in res.sort_values("timestamp").groupby("meter_id"):
        lab = g["true_type"].to_numpy()
        flag = g["is_anomaly"].to_numpy()
        i = 0
        while i < len(lab):
            if lab[i] == "none":
                i += 1
                continue
            j = i
            while j < len(lab) and lab[j] == lab[i]:
                j += 1
            total_ep += 1
            caught += int(flag[i:j].any())
            i = j

    days = sum((g["timestamp"].max() - g["timestamp"].min()).total_seconds() / 86400
               for _, g in res.groupby("meter_id"))
    return {
        "rows": int(len(res)), "precision": precision, "recall": recall, "f1": f1,
        "episodes": total_ep, "episodes_caught": caught,
        "episode_recall": caught / total_ep if total_ep else float("nan"),
        "false_alarm_rows": fp,
        "false_alarm_rows_per_meter_day": fp / days if days else float("nan"),
        "latency_ms_p50": float(np.percentile(res["latency_ms"], 50)),
        "latency_ms_p95": float(np.percentile(res["latency_ms"], 95)),
        "latency_ms_max": float(res["latency_ms"].max()),
    }


def type_report(res: pd.DataFrame):
    rep = classification_report(res["true_type"], res["pred_type"], labels=TYPES,
                                zero_division=0, output_dict=False)
    cm = pd.DataFrame(confusion_matrix(res["true_type"], res["pred_type"], labels=TYPES),
                      index=[f"true:{t}" for t in TYPES], columns=[f"pred:{t}" for t in TYPES])
    return rep, cm
