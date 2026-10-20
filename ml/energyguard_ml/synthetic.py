"""Stand-in training data in the SAME CSV format as `simulator.py --export-csv`.

Use it only until Harsh's real export is available (or for tests/CI). The real
simulator export is the data you should train the final model on.
Columns: meter_id, timestamp, total_power_w, voltage_v, appliances_w.<name> x8, sim_label
"""
from __future__ import annotations

import argparse

import numpy as np
import pandas as pd

from .features import APPLIANCES

FAULTS = ["baseload_leakage", "high_load_spike", "voltage_fluctuation"]


def _daily_flag(rng, day, p):
    return (rng.random(int(day.max()) + 1) < p)[day]


def _meter_frame(rng, meter_id, ts, interval_s, fault_rate, scale):
    n = len(ts)
    day = ((ts - ts[0]).total_seconds() // 86400).astype(int).to_numpy()
    lh = (ts.hour.to_numpy() + ts.minute.to_numpy() / 60.0 + 5.5) % 24   # local (IST) hour
    mins = np.arange(n) * interval_s / 60.0

    def noise(sd):
        return rng.normal(0, sd, n)

    ac_day = _daily_flag(rng, day, 0.85)
    ac = np.where((lh >= 13) & (lh < 18), 1200, np.where((lh >= 18) & (lh < 23), 700, 0)) * ac_day
    ac = np.clip(ac * (1 + noise(0.03)), 0, None)
    fridge = 140 + 20 * np.sin(2 * np.pi * mins / 40) + noise(4)
    geyser = np.where((lh >= 6) & (lh < 7.2), 1500, 0) * _daily_flag(rng, day, 0.7)
    wm = np.where((lh >= 9.5) & (lh < 10.5), 450, 0) * _daily_flag(rng, day, 0.4)
    lighting = np.where((lh >= 18) & (lh < 23), 90, np.where((lh >= 5) & (lh < 7), 40, 6)) + noise(3)
    fan = np.where((lh >= 10) & (lh < 23), 60, np.where(lh < 6, 50, 0)) + noise(3)
    tv = np.where((lh >= 19) & (lh < 22.5), 110, 0) * _daily_flag(rng, day, 0.7)
    other = 60 + noise(8)

    app = {"ac": ac, "fridge": fridge, "geyser": geyser, "washing_machine": wm,
           "lighting": lighting, "fan": fan, "tv": tv, "other": other}
    for k in app:
        app[k] = np.clip(app[k] * scale, 0, None)

    voltage = 230.0 - 2.0 * ((lh >= 18) & (lh < 22)) + noise(1.5)
    label = np.array(["normal"] * n, dtype=object)

    # fault episodes
    mean_len = max(1, int(15 * 60 / interval_s))
    n_ep = int(n * fault_rate / mean_len)
    for _ in range(n_ep):
        kind = FAULTS[rng.integers(len(FAULTS))]
        length = int(rng.integers(5, 31) * 60 / interval_s)
        for _try in range(50):
            s = int(rng.integers(0, max(1, n - length)))
            e = s + length
            if (label[s:e] != "normal").any():
                continue
            if kind == "baseload_leakage" and not ((lh[s:e] < 5.5) & (lh[s:e] >= 0)).all():
                continue
            break
        else:
            continue
        label[s:e] = kind
        if kind == "high_load_spike":
            app["other"][s:e] += rng.uniform(2000, 3500)
        elif kind == "baseload_leakage":
            app["other"][s:e] += rng.uniform(600, 900)
        else:
            sign = rng.choice([-1, 1], size=e - s)
            voltage[s:e] = 230 + sign * rng.uniform(22, 40, size=e - s)

    total = sum(app.values())
    volt = np.round(voltage, 1).astype(object)
    miss = (rng.random(n) < 0.0005) & (label == "normal")
    volt[miss] = None

    out = pd.DataFrame({
        "meter_id": meter_id,
        "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_power_w": np.round(total, 1),
        "voltage_v": volt,
    })
    for a in APPLIANCES:
        out[f"appliances_w.{a}"] = np.round(app[a], 1)
    out["total_power_w"] = np.round(out[[f"appliances_w.{a}" for a in APPLIANCES]].sum(axis=1), 1)
    out["sim_label"] = label
    return out


def make_synthetic(days=30, meters=3, interval_s=60, start="2026-09-01",
                   seed=0, fault_rate=0.02) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    n = int(days * 86400 // interval_s)
    ts = pd.date_range(start, periods=n, freq=f"{interval_s}s", tz="UTC")
    frames = []
    for m in range(1, meters + 1):
        frames.append(_meter_frame(rng, f"M{m}", ts, interval_s, fault_rate, scale=rng.uniform(0.8, 1.3)))
    return pd.concat(frames, ignore_index=True)


def main():
    ap = argparse.ArgumentParser(description="Make a stand-in simulator CSV")
    ap.add_argument("--out", required=True)
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--meters", type=int, default=3)
    ap.add_argument("--interval-s", type=int, default=60)
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    df = make_synthetic(a.days, a.meters, a.interval_s, seed=a.seed)
    df.to_csv(a.out, index=False)
    print(f"wrote {len(df)} rows -> {a.out}")
    print(df.sim_label.value_counts())


if __name__ == "__main__":
    main()
