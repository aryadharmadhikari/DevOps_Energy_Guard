"""Training helpers (used by the notebooks and by the CLI).

CLI:  python -m energyguard_ml.training --csv data/sim_30d.csv --out models/model.pkl

Idea: Isolation Forest learns what NORMAL looks like (trained on rows whose
sim_label == "normal"). Its raw score is calibrated so that score 0.5 sits at the
THRESH_PCT percentile of held-out normal data. Simple rules (inference.py) then
name the fault type.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from .features import APPLIANCES, FEATURE_NAMES, WINDOW, build_features

REQUIRED = (["meter_id", "timestamp", "total_power_w", "voltage_v", "sim_label"]
            + [f"appliances_w.{a}" for a in APPLIANCES])
MODEL_VERSION = "iforest-v1"


def load_csv(path) -> pd.DataFrame:
    """Load a simulator CSV. Adds a `source` column (file name) so that files with
    different cadences are never mixed inside one rolling window."""
    df = pd.read_csv(path)
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError(f"CSV {path} is missing columns: {missing}. Found: {list(df.columns)}")
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df["source"] = Path(path).stem
    return df


def time_split(df: pd.DataFrame, frac: float = 0.7):
    """Chronological split (earlier = train, later = test)."""
    cut = df["timestamp"].quantile(frac)
    return df[df["timestamp"] <= cut].copy(), df[df["timestamp"] > cut].copy()


def _group_keys(df):
    return ["source", "meter_id"] if "source" in df.columns else ["meter_id"]


def to_readings(df: pd.DataFrame) -> list[dict]:
    """Flat CSV rows -> contract Reading dicts (section 4.1), oldest first."""
    d = df.copy()
    d["timestamp"] = pd.to_datetime(d["timestamp"], utc=True)   # accepts text or datetime
    d = d.sort_values("timestamp")
    ts = d["timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%SZ").tolist()
    meter = d["meter_id"].tolist()
    total = d["total_power_w"].astype(float).tolist()
    volt = d["voltage_v"].astype(float).tolist()
    label = d["sim_label"].tolist()
    apps = {a: d[f"appliances_w.{a}"].fillna(0.0).astype(float).tolist() for a in APPLIANCES}
    out = []
    for i in range(len(d)):
        v = volt[i]
        out.append({
            "meter_id": meter[i],
            "timestamp": ts[i],
            "total_power_w": total[i],
            "voltage_v": None if v != v else v,          # NaN -> None (null)
            "appliances_w": {a: apps[a][i] for a in APPLIANCES},
            "sim_label": label[i],
        })
    return out


def build_matrix(df: pd.DataFrame):
    """Feature matrix using the SAME build_features() as score_reading().
    Returns (X, feature_dicts, labels)."""
    X, feats, labels = [], [], []
    for _, g in df.groupby(_group_keys(df), sort=False):
        recs = to_readings(g)
        for i, r in enumerate(recs):
            f = build_features(r, recs[max(0, i - WINDOW):i])
            feats.append(f)
            labels.append(r["sim_label"])
            X.append([f[k] for k in FEATURE_NAMES])
    return np.array(X, dtype=float), feats, np.array(labels)


def fit_artifact(train_df: pd.DataFrame, threshold_pct: float = 99.9,
                 n_estimators: int = 100, random_state: int = 42,
                 model_version: str = MODEL_VERSION) -> dict:
    X, feats, y = build_matrix(train_df)
    normal_idx = np.where(y == "normal")[0]
    if len(normal_idx) < 200:
        raise ValueError(f"Need at least 200 normal rows to train, got {len(normal_idx)}")

    rng = np.random.default_rng(random_state)
    perm = rng.permutation(normal_idx)
    n_cal = max(1, int(0.2 * len(perm)))
    cal_idx, fit_idx = perm[:n_cal], perm[n_cal:]

    model = IsolationForest(n_estimators=n_estimators, contamination="auto",
                            random_state=random_state, n_jobs=1).fit(X[fit_idx])

    raw_cal = -model.score_samples(X[cal_idx])               # held-out normal rows
    lo = float(np.median(raw_cal))
    p = float(np.percentile(raw_cal, threshold_pct))
    calibration = {"p": p, "scale": float(max(p - lo, 1e-6)), "k": 4.0,
                   "threshold_pct": float(threshold_pct)}

    nf = pd.DataFrame([feats[i] for i in normal_idx])
    hour_mean = nf.groupby("hour")["total_power_w"].mean()
    overall = float(nf["total_power_w"].mean())
    low_hours = sorted(int(h) for h in hour_mean.index[hour_mean <= 0.6 * overall])
    if not low_hours:                                   # fallback: the 4 quietest hours
        low_hours = sorted(int(h) for h in hour_mean.nsmallest(4).index)
    # per-hour limit: highest normal power seen in that hour, plus a margin
    hour_w = {int(h): float(np.percentile(g["total_power_w"], 99.99) * 1.1)
              for h, g in nf.groupby("hour")}
    thresholds = {
        "spike_w": float(np.percentile(nf["total_power_w"], 99.99) * 1.05),
        "low_hours": low_hours,
        "hour_w": hour_w,
        "z_hi": float(max(4.0, np.percentile(nf["p_zscore"], 99.99))),
        "v_lo": float(np.percentile(nf["voltage_v"], 0.01) - 2.0),
        "v_hi": float(np.percentile(nf["voltage_v"], 99.99) + 2.0),
    }
    return {"model": model, "calibration": calibration, "thresholds": thresholds,
            "feature_names": list(FEATURE_NAMES), "model_version": model_version,
            "n_train_normal": int(len(normal_idx))}


def save_artifact(artifact: dict, path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(artifact, path)
    return path


def main():
    ap = argparse.ArgumentParser(description="Train EnergyGuard anomaly model")
    ap.add_argument("--csv", nargs="+", required=True, help="one or more simulator CSVs")
    ap.add_argument("--out", default="models/model.pkl")
    ap.add_argument("--threshold-pct", type=float, default=99.9)
    ap.add_argument("--train-frac", type=float, default=0.7)
    a = ap.parse_args()
    trains = [time_split(load_csv(p), a.train_frac)[0] for p in a.csv]
    art = fit_artifact(pd.concat(trains, ignore_index=True), threshold_pct=a.threshold_pct)
    print("saved", save_artifact(art, a.out))
    print("thresholds:", art["thresholds"])


if __name__ == "__main__":
    main()
