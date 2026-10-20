#!/usr/bin/env python
"""run_pipeline.py - One-shot script: convert UCI CSV -> train model -> verify.

Run from ml/ directory:
    .venv\\Scripts\\python run_pipeline.py

Override paths with env vars:
    UCI_TXT   (default: data/household_power_consumption.txt)
    SIM_CSV   (default: data/sim_30d.csv)
    MODEL_OUT (default: models/model.pkl)
"""
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent

UCI_TXT   = os.environ.get("UCI_TXT",   str(ROOT / "data" / "household_power_consumption.txt"))
SIM_CSV   = os.environ.get("SIM_CSV",   str(ROOT / "data" / "sim_30d.csv"))
MODEL_OUT = os.environ.get("MODEL_OUT", str(ROOT / "models" / "model.pkl"))

# ── 1. Validate input ────────────────────────────────────────────────────────
if not Path(UCI_TXT).is_file():
    print(f"ERROR: UCI dataset not found at {UCI_TXT}")
    print("Please download from https://archive.ics.uci.edu/dataset/235 "
          "and place it at data/household_power_consumption.txt")
    sys.exit(1)

print("=" * 60)
print("EnergyGuard ML Pipeline")
print("=" * 60)

# ── 2. Add package to path ───────────────────────────────────────────────────
sys.path.insert(0, str(ROOT))

# ── 3. Convert UCI -> sim CSV ────────────────────────────────────────────────
print("\n[1/3] Converting UCI dataset -> simulator CSV ...")
t0 = time.time()
from energyguard_ml.uci_converter import convert
convert(
    txt_path=UCI_TXT,
    out_path=SIM_CSV,
    days=30,
    meters=3,
    seed=42,
    fault_rate=0.025,
)
print(f"      Done in {time.time()-t0:.1f}s")

# ── 4. Train model ───────────────────────────────────────────────────────────
print("\n[2/3] Training Isolation Forest model ...")
t0 = time.time()
import pandas as pd
from energyguard_ml.training import load_csv, time_split, fit_artifact, save_artifact

df      = load_csv(SIM_CSV)
train   = time_split(df, frac=0.7)[0]
print(f"      Training rows: {len(train):,}  "
      f"  (normal={sum(train['sim_label']=='normal'):,}  "
      f"fault={sum(train['sim_label']!='normal'):,})")

artifact = fit_artifact(train, threshold_pct=99.9)
save_artifact(artifact, MODEL_OUT)
print(f"      Model saved -> {MODEL_OUT}  ({time.time()-t0:.1f}s)")
print(f"      Thresholds: spike_w={artifact['thresholds']['spike_w']:.0f}W  "
      f"z_hi={artifact['thresholds']['z_hi']:.2f}  "
      f"v_lo={artifact['thresholds']['v_lo']:.1f}V  "
      f"v_hi={artifact['thresholds']['v_hi']:.1f}V")

# ── 5. Quick smoke test ──────────────────────────────────────────────────────
print("\n[3/3] Smoke-testing score_reading() ...")
os.environ["MODEL_PATH"] = MODEL_OUT
import importlib
import energyguard_ml.inference as inf_mod
importlib.reload(inf_mod)

NORMAL = {
    "meter_id": "M1",
    "timestamp": "2026-10-01T14:00:00Z",
    "total_power_w": 1200.0,
    "voltage_v": 231.0,
    "appliances_w": {
        "ac": 700.0, "fridge": 140.0, "geyser": 0.0,
        "washing_machine": 0.0, "lighting": 80.0,
        "fan": 60.0, "tv": 110.0, "other": 110.0,
    },
}
SPIKE = {**NORMAL, "total_power_w": 14000.0,
         "appliances_w": {**NORMAL["appliances_w"], "other": 12700.0}}
VOLTAGE = {**NORMAL, "voltage_v": 165.0}

import time as _t
results = {}
for name, reading in [("normal", NORMAL), ("spike", SPIKE), ("voltage_fault", VOLTAGE)]:
    t0 = _t.perf_counter()
    out = inf_mod.score_reading(reading)
    ms  = (_t.perf_counter() - t0) * 1000
    results[name] = (out, ms)
    print(f"  {name:15s} -> is_anomaly={str(out['is_anomaly']):5s} "
          f"type={out['anomaly_type']:25s} score={out['score']:.3f}  {ms:.1f}ms")

print("\n" + "=" * 60)
print("Pipeline complete! Model ready for simulation.")
print(f"Model: {MODEL_OUT}")
print(f"Use:  MODEL_PATH={MODEL_OUT}")
print("=" * 60)
