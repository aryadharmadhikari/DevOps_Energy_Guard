"""Checks for simulator.py (standard library only). Run: python test_simulator.py"""

import csv
import math
import os
import random
import tempfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import simulator as sim

IST = timezone(timedelta(hours=5, minutes=30))
START = datetime(2026, 10, 5, tzinfo=timezone.utc)  # a Monday


def readings(meter, days, fault_rate=1.0):
    rng = random.Random(1)
    ts = START
    while ts < START + timedelta(days=days):
        yield sim.make_reading(meter, ts, seed=42, fault_rate=fault_rate, noise=rng)
        ts += timedelta(minutes=1)


def test_total_is_sum_of_appliances():
    for r in readings(1, 2):
        assert set(r["appliances_w"]) == set(sim.APPLIANCES)
        assert math.isclose(r["total_power_w"], sum(r["appliances_w"].values()), abs_tol=1e-6), r
        assert r["timestamp"].endswith("Z")


def test_daily_pattern_follows_ist():
    by_hour = defaultdict(lambda: defaultdict(float))
    for r in readings(1, 14, fault_rate=0):
        hour = datetime.fromisoformat(r["timestamp"].replace("Z", "+00:00")).astimezone(IST).hour
        for k, v in r["appliances_w"].items():
            by_hour[hour][k] += v
        by_hour[hour]["total"] += r["total_power_w"]
    assert by_hour[7]["geyser"] > 10 * by_hour[3]["geyser"] + 1, "geyser belongs to the morning"
    assert by_hour[1]["ac"] > 3 * by_hour[11]["ac"], "AC mostly runs at night"
    assert by_hour[21]["lighting"] > 5 * by_hour[12]["lighting"], "lights after sunset"
    totals = [by_hour[h]["total"] for h in range(24)]
    assert max(totals) > 2 * min(totals), "the day is not flat"


def test_energy_is_a_real_home():
    for meter, (lo, hi) in {1: (5, 11), 2: (3.5, 8), 3: (6.5, 14)}.items():
        kwh = sum(r["total_power_w"] for r in readings(meter, 14, fault_rate=0)) / 60 / 1000 / 14
        assert lo < kwh < hi, f"M{meter}: {kwh:.1f} kWh a day"


def test_faults_are_episodes_not_blips():
    labels = [r["sim_label"] for r in readings(1, 30, fault_rate=1.5)]
    faults = [x for x in labels if x != "normal"]
    assert faults, "30 days should contain faults"
    episodes = sum(1 for a, b in zip(["normal"] + labels, labels) if b != "normal" and a != b)
    assert len(faults) / episodes >= 3, "a fault lasts several minutes"
    assert {"high_load_spike", "baseload_leakage", "voltage_fluctuation"} <= set(faults)


def test_same_home_every_time():
    a = sim.day_plan(2, START.date(), 42, 1.0)
    sim.day_plan.cache_clear()
    assert sim.day_plan(2, START.date(), 42, 1.0) == a


def test_forced_fault():
    r = sim.make_reading(1, START, forced_fault="voltage_fluctuation")
    assert r["sim_label"] == "voltage_fluctuation" and not 207 <= r["voltage_v"] <= 253


def test_csv_columns_match_the_contract():
    path = os.path.join(tempfile.mkdtemp(), "sim.csv")

    class Args:
        meters, days, seed, fault_rate = 2, 1, 42, 1.0

    sim.export_csv(path, Args)
    with open(path) as f:
        header = next(csv.reader(f))
    assert header == ["meter_id", "timestamp", "total_power_w", "voltage_v",
                      *[f"appliances_w.{a}" for a in sim.APPLIANCES], "sim_label"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
