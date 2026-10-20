"""Convert the UCI Individual Household Electric Power Consumption dataset
to the EnergyGuard simulator CSV schema.

UCI schema (semicolon-delimited, may contain '?'):
    Date;Time;Global_active_power(kW);Global_reactive_power;Voltage(V);
    Global_intensity;Sub_metering_1(Wh/interval);Sub_metering_2(Wh/interval);
    Sub_metering_3(Wh/interval)

Sub-meter mapping:
    Sub_metering_1 -> kitchen  (dishwasher, oven, microwave)         -> other
    Sub_metering_2 -> laundry  (washing_machine, fridge/freezer)     -> washing_machine + fridge
    Sub_metering_3 -> climate  (electric water heater + AC)          -> geyser + ac

Remaining load (total - sub1 - sub2 - sub3) is distributed to:
    lighting, fan, tv (using time-of-day heuristics)

Fault episodes injected:
    baseload_leakage   : nighttime (00:00-05:30 IST) elevated load on 'other'
    high_load_spike    : sudden large 'other' surge
    voltage_fluctuation: voltage +/-25-40 V from nominal

CLI:
    python -m energyguard_ml.uci_converter \\
        --txt  data/household_power_consumption.txt \\
        --out  data/sim_30d.csv \\
        --days 30 --meters 3 --seed 0
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
import pandas as pd

from .features import APPLIANCES

# -- UCI column names after parsing ------------------------------------------
_UCI_COLS = [
    "Date", "Time",
    "Global_active_power",   # kW
    "Global_reactive_power", # kW
    "Voltage",               # V
    "Global_intensity",      # A
    "Sub_metering_1",        # Wh per minute
    "Sub_metering_2",        # Wh per minute
    "Sub_metering_3",        # Wh per minute
]

FAULTS = ["baseload_leakage", "high_load_spike", "voltage_fluctuation"]

V_NOMINAL_UCI = 230.0
V_NOMINAL_EG  = 230.0


def load_uci(path: str | Path) -> pd.DataFrame:
    """Load the raw UCI txt file and return a clean DataFrame (Watts, UTC)."""
    print(f"Loading UCI dataset from {path} ...")
    df = pd.read_csv(
        path,
        sep=";",
        names=_UCI_COLS,
        header=0,
        na_values=["?"],
        dtype=str,
        low_memory=False,
    )

    df["timestamp_local"] = pd.to_datetime(
        df["Date"] + " " + df["Time"], dayfirst=True, errors="coerce"
    )
    df = df.dropna(subset=["timestamp_local"])

    # France is UTC+1 winter / UTC+2 summer; tz_localize handles DST
    df["timestamp"] = (
        df["timestamp_local"]
        .dt.tz_localize("Europe/Paris", ambiguous="NaT", nonexistent="NaT")
        .dt.tz_convert("UTC")
    )
    df = df.dropna(subset=["timestamp"])
    df = df.sort_values("timestamp").reset_index(drop=True)

    for c in ["Global_active_power", "Voltage", "Sub_metering_1",
              "Sub_metering_2", "Sub_metering_3"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")

    df = df.dropna(subset=["Global_active_power"])

    df["total_w"] = df["Global_active_power"] * 1000.0   # kW -> W
    df["sub1_w"]  = df["Sub_metering_1"].fillna(0.0)     # kitchen Wh/min ~ W
    df["sub2_w"]  = df["Sub_metering_2"].fillna(0.0)     # laundry
    df["sub3_w"]  = df["Sub_metering_3"].fillna(0.0)     # climate
    df["voltage"] = df["Voltage"].fillna(V_NOMINAL_UCI)

    df["residual_w"] = np.clip(
        df["total_w"] - df["sub1_w"] - df["sub2_w"] - df["sub3_w"], 0, None
    )
    # IST local hour for time-of-day heuristics (UTC + 5.5 h)
    df["ist_hour"] = (df["timestamp"].dt.hour + 5.5) % 24

    print(f"  Loaded {len(df):,} rows  "
          f"{df['timestamp'].iloc[0]} -> {df['timestamp'].iloc[-1]}")
    return df


def _split_appliances(df: pd.DataFrame) -> pd.DataFrame:
    """Derive the 8 EnergyGuard appliance columns from the 3 UCI sub-meters
    and the residual.  All values in Watts."""
    d = df.copy()
    h = d["ist_hour"].values

    # sub2: fridge 60 % / washing_machine 40 %
    d["app_fridge"]          = d["sub2_w"] * 0.60
    d["app_washing_machine"] = d["sub2_w"] * 0.40

    # sub3: geyser in morning window, AC otherwise
    geyser_mask   = (h >= 5.5) & (h < 7.5)
    d["app_geyser"] = np.where(geyser_mask, d["sub3_w"], 0.0)
    d["app_ac"]     = np.where(~geyser_mask, d["sub3_w"], 0.0)

    # residual split with soft time-of-day weights
    tv_frac = np.where((h >= 19.0) & (h < 23.0), 0.30, 0.05)
    lighting_frac = np.where(
        ((h >= 5.0) & (h < 7.5)) | ((h >= 18.0) & (h < 23.0)), 0.25,
        np.where(h < 5.0, 0.10, 0.08),
    )
    fan_frac  = np.where((h >= 10.0) & (h < 23.0), 0.12, 0.06)
    other_frac = np.clip(1.0 - tv_frac - lighting_frac - fan_frac, 0.05, 1.0)

    d["app_tv"]       = d["residual_w"] * tv_frac
    d["app_lighting"] = d["residual_w"] * lighting_frac
    d["app_fan"]      = d["residual_w"] * fan_frac
    d["app_other"]    = d["residual_w"] * other_frac + d["sub1_w"]
    return d


def _inject_faults(
    df: pd.DataFrame,
    rng: np.random.Generator,
    fault_rate: float = 0.025,
    interval_s: int = 60,
) -> pd.DataFrame:
    """Inject synthetic fault episodes into a single-meter DataFrame."""
    n = len(df)
    label = np.array(["normal"] * n, dtype=object)
    mean_len = max(1, int(15 * 60 / interval_s))
    n_ep = int(n * fault_rate / mean_len)
    h = df["ist_hour"].values

    for _ in range(n_ep):
        kind   = FAULTS[int(rng.integers(len(FAULTS)))]
        length = int(rng.integers(5, 31) * 60 / interval_s)

        for _try in range(50):
            s = int(rng.integers(0, max(1, n - length)))
            e = s + length
            if (label[s:e] != "normal").any():
                continue
            if kind == "baseload_leakage":
                if not ((h[s:e] < 5.5) | (h[s:e] >= 22.5)).all():
                    continue
            break
        else:
            continue

        label[s:e] = kind
        if kind == "high_load_spike":
            df.iloc[s:e, df.columns.get_loc("app_other")] += rng.uniform(2000, 3500)
        elif kind == "baseload_leakage":
            df.iloc[s:e, df.columns.get_loc("app_other")] += rng.uniform(600, 900)
        elif kind == "voltage_fluctuation":
            sign = rng.choice([-1, 1], size=e - s)
            vc = df.columns.get_loc("voltage")
            df.iloc[s:e, vc] = 230.0 + sign * rng.uniform(22, 40, size=e - s)

    df["sim_label"] = label
    return df


def _recalc_total(df: pd.DataFrame) -> pd.DataFrame:
    app_cols = [f"app_{a}" for a in APPLIANCES]
    df["total_power_w"] = df[app_cols].clip(lower=0).sum(axis=1)
    return df


def convert(
    txt_path: str | Path,
    out_path: str | Path,
    days: int = 30,
    meters: int = 3,
    seed: int = 0,
    fault_rate: float = 0.025,
    start_date: str | None = None,
) -> Path:
    """Full conversion pipeline.  Returns path to the written CSV."""
    rng = np.random.default_rng(seed)
    uci = load_uci(txt_path)

    total_days = (uci["timestamp"].iloc[-1] - uci["timestamp"].iloc[0]).days
    if total_days < days:
        raise ValueError(
            f"UCI dataset spans only {total_days} days; requested {days}."
        )

    win_start = (
        pd.Timestamp(start_date, tz="UTC") if start_date
        else uci["timestamp"].iloc[0].normalize() + pd.Timedelta(days=1)
    )
    win_end = win_start + pd.Timedelta(days=days)
    window  = uci[(uci["timestamp"] >= win_start) & (uci["timestamp"] < win_end)].copy()

    if len(window) < days * 60 * 12:
        raise ValueError(
            "Not enough rows in the selected window. "
            "Try a different --start-date or a shorter --days."
        )

    window = _split_appliances(window)

    frames = []
    for m_idx in range(meters):
        meter_id = f"M{m_idx + 1}"
        mdf = window.copy()

        # Scale each meter +/-20% and add small appliance noise
        scale = float(rng.uniform(0.8, 1.2))
        for a in APPLIANCES:
            col = f"app_{a}"
            mdf[col] = np.clip(
                mdf[col] * scale + rng.normal(0, 5, len(mdf)), 0, None
            )

        mdf["voltage"] = mdf["voltage"] + rng.normal(0, 1.5, len(mdf))

        mdf = _inject_faults(mdf, rng, fault_rate=fault_rate)
        mdf = _recalc_total(mdf)

        # Rare missing voltage (0.05 % of normal readings)
        null_mask = (rng.random(len(mdf)) < 0.0005) & (mdf["sim_label"] == "normal")
        volt_vals = mdf["voltage"].round(1).astype(object)
        volt_vals[null_mask] = None

        row = {
            "meter_id":  meter_id,
            "timestamp": mdf["timestamp"].dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "total_power_w": mdf["total_power_w"].round(1),
            "voltage_v": volt_vals,
        }
        for a in APPLIANCES:
            row[f"appliances_w.{a}"] = mdf[f"app_{a}"].round(1)
        row["sim_label"] = mdf["sim_label"]
        frames.append(pd.DataFrame(row))

    result = (
        pd.concat(frames, ignore_index=True)
        .sort_values(["meter_id", "timestamp"])
        .reset_index(drop=True)
    )

    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(out_path, index=False)
    print(f"\nWrote {len(result):,} rows -> {out_path}")
    print(result["sim_label"].value_counts().to_string())
    return out_path


def main():
    ap = argparse.ArgumentParser(
        description="Convert UCI household dataset -> EnergyGuard simulator CSV"
    )
    ap.add_argument("--txt",  default="data/household_power_consumption.txt")
    ap.add_argument("--out",  default="data/sim_30d.csv")
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--meters", type=int, default=3)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--fault-rate", type=float, default=0.025)
    ap.add_argument("--start-date", default=None,
                    help="UTC start YYYY-MM-DD (default: first full day in file)")
    a = ap.parse_args()
    convert(a.txt, a.out, days=a.days, meters=a.meters, seed=a.seed,
            fault_rate=a.fault_rate, start_date=a.start_date)


if __name__ == "__main__":
    main()
