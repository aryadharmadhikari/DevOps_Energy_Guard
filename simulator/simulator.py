#!/usr/bin/env python3
"""EnergyGuard meter simulator (CONTRACT.md section 6.3).

Each meter is a home in Mumbai whose appliances each have a smart plug or sub-meter;
the simulator plays that role. EnergyGuard does not split one total reading into
appliances.

A home's state is a pure function of (meter, time). Which appliances run on a given day
comes from a daily plan drawn from a seeded random generator, so live mode, backfill and
the CSV export all describe the same homes, and a restart continues the same day.
Daily patterns follow IST, because that is the clock the homes live by.

    python simulator.py                                   live, every SIM_INTERVAL_SECONDS
    python simulator.py --backfill-days 30                30 days of history, then exit
    python simulator.py --export-csv data/sim_30d.csv --days 30
    python simulator.py --inject high_load_spike --meter M1 --minutes 3
"""

import argparse
import csv
import functools
import json
import math
import os
import random
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import httpx

APPLIANCES = ["ac", "fridge", "geyser", "washing_machine", "lighting", "fan", "tv", "other"]
FAULT_TYPES = ["baseload_leakage", "high_load_spike", "voltage_fluctuation"]

BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8000/api/v1").rstrip("/")
RETRY_SECONDS = 5
BATCH_SIZE = 500
IST = timezone(timedelta(hours=5, minutes=30))

# --inject talks to a running live simulator through these files, so a demo fault
# changes that simulator's readings instead of starting a second one.
CONTROL_FILE = os.path.join(tempfile.gettempdir(), "energyguard-inject.json")
ALIVE_FILE = os.path.join(tempfile.gettempdir(), "energyguard-live")

# Home size per meter: M1 an average flat, M2 a small one, M3 a bigger family home.
HOME_SIZE = {1: 1.0, 2: 0.7, 3: 1.3}


def home_size(meter_number):
    return HOME_SIZE.get(meter_number, 0.8 + 0.1 * (meter_number % 5))


# ---------------------------------------------------------------------------
# Daily plan: what each home does on one IST day
# ---------------------------------------------------------------------------


@dataclass
class Window:
    """Something switched on from `start` to `end`, in IST hours after midnight of the
    plan's day (an end above 24 runs past midnight into the next day)."""

    start: float
    end: float
    watts: float = 0.0
    kind: str = ""

    def covers(self, hour):
        return self.start <= hour < self.end


@dataclass
class DayPlan:
    ac: list = field(default_factory=list)
    geyser: list = field(default_factory=list)
    washing: list = field(default_factory=list)
    tv: list = field(default_factory=list)
    kitchen: list = field(default_factory=list)  # mixer, microwave, iron: counted as "other"
    faults: list = field(default_factory=list)
    lights_on: float = 18.6
    lights_off: float = 23.2
    fans: int = 2
    fridge_cycle: float = 48.0  # minutes
    fridge_duty: float = 0.4
    fridge_watts: float = 130.0
    ac_watts: float = 1250.0
    base_watts: float = 45.0


def _window(rng, start_lo, start_hi, hours_lo, hours_hi, watts=0.0, kind=""):
    start = rng.uniform(start_lo, start_hi)
    return Window(start, start + rng.uniform(hours_lo, hours_hi), watts, kind)


@functools.lru_cache(maxsize=4096)
def day_plan(meter_number, day, seed, fault_rate):
    """The plan for one meter on one IST day. Same inputs, same plan, on any machine."""
    rng = random.Random(f"{seed}:{meter_number}:{day.isoformat()}")
    size = home_size(meter_number)
    weekend = day.weekday() >= 5
    plan = DayPlan(
        fans=1 if size < 0.8 else 2 if size < 1.2 else 3,
        fridge_cycle=rng.uniform(40, 55),
        fridge_duty=rng.uniform(0.35, 0.45),
        fridge_watts=rng.uniform(110, 150),
        ac_watts=rng.uniform(1150, 1400) * (1.15 if size > 1.2 else 1.0),
        base_watts=rng.uniform(35, 55) * size,
        lights_on=rng.uniform(18.4, 18.9),
        lights_off=rng.uniform(22.6, 23.8),
    )

    # AC: many nights while sleeping, some hot afternoons (more at weekends). Bigger homes use it more.
    ac_habit = min(1.0, size)
    if rng.random() < 0.55 * ac_habit:
        plan.ac.append(_window(rng, 22.0, 23.5, 5.0, 7.0))
    if rng.random() < (0.45 if weekend else 0.12) * ac_habit:
        plan.ac.append(_window(rng, 13.0, 14.5, 1.5, 3.0))

    # Geyser: a morning bath most days, sometimes an evening one. Heaters have a fixed size.
    if rng.random() < 0.9:
        plan.geyser.append(_window(rng, 6.3, 8.0, 0.25, 0.4, rng.uniform(1800, 2000)))
    if rng.random() < 0.2:
        plan.geyser.append(_window(rng, 19.0, 21.0, 0.2, 0.3, rng.uniform(1800, 2000)))

    if rng.random() < (0.65 if weekend else 0.2):
        plan.washing.append(_window(rng, 9.0, 11.0, 0.75, 1.1, rng.uniform(380, 480)))

    if rng.random() < 0.85:
        plan.tv.append(_window(rng, 19.0, 20.5, 2.0, 3.5, rng.uniform(90, 130) * size))
    if weekend and rng.random() < 0.5:
        plan.tv.append(_window(rng, 13.0, 15.0, 1.0, 2.5, rng.uniform(90, 130) * size))

    if rng.random() < 0.7:
        plan.kitchen.append(_window(rng, 7.3, 8.6, 0.06, 0.1, 550))  # mixer
    if rng.random() < 0.5:
        plan.kitchen.append(_window(rng, 20.0, 21.3, 0.04, 0.08, 1100))  # microwave
    if weekend and rng.random() < 0.5:
        plan.kitchen.append(_window(rng, 10.0, 12.0, 0.2, 0.35, 1000))  # iron

    # Faults: about `fault_rate` episodes a day, each lasting minutes, never one-reading blips.
    for _ in range(_poisson(rng, fault_rate)):
        kind = rng.choice(FAULT_TYPES)
        if kind == "baseload_leakage":  # something left drawing power in the quiet hours
            plan.faults.append(_window(rng, 0.5, 3.5, 0.75, 2.0, rng.uniform(350, 550) * size, kind))
        elif kind == "high_load_spike":
            plan.faults.append(_window(rng, 7.0, 22.5, 4 / 60, 10 / 60, rng.uniform(2500, 3500), kind))
        else:
            volts = rng.choice([rng.uniform(186, 200), rng.uniform(254, 262)])
            plan.faults.append(_window(rng, 0.0, 23.5, 3 / 60, 12 / 60, volts, kind))
    return plan


def _poisson(rng, mean):
    # Knuth's method; fine for the small means used here.
    limit, k, p = math.exp(-mean), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def _active(windows, hour, prev_windows):
    """The window running at `hour`, including one that started the day before."""
    for w in windows:
        if w.covers(hour):
            return w
    for w in prev_windows:
        if w.covers(hour + 24):
            return w
    return None


# ---------------------------------------------------------------------------
# One reading
# ---------------------------------------------------------------------------


def make_reading(meter_number, ts, seed=42, fault_rate=1.0, forced_fault=None, noise=random):
    """The Reading (contract 4.1, without reading_id) for one meter at UTC time `ts`."""
    local = ts.astimezone(IST)
    hour = local.hour + local.minute / 60 + local.second / 3600
    minute_of_day = hour * 60
    plan = day_plan(meter_number, local.date(), seed, fault_rate)
    prev = day_plan(meter_number, local.date() - timedelta(days=1), seed, fault_rate)
    size = home_size(meter_number)

    def jitter(watts):
        return max(0.0, watts * noise.uniform(0.97, 1.03))

    w = dict.fromkeys(APPLIANCES, 0.0)

    # Fridge and AC compressors cycle on and off by themselves.
    phase = meter_number * 7.3
    if (minute_of_day + phase) % plan.fridge_cycle < plan.fridge_cycle * plan.fridge_duty:
        w["fridge"] = jitter(plan.fridge_watts)
    else:
        w["fridge"] = jitter(4)
    ac = _active(plan.ac, hour, prev.ac)
    if ac:
        compressor = (minute_of_day + phase * 2) % 30 < 18
        w["ac"] = jitter(plan.ac_watts if compressor else 80)

    for key, windows, prev_windows in (
        ("geyser", plan.geyser, prev.geyser),
        ("washing_machine", plan.washing, prev.washing),
        ("tv", plan.tv, prev.tv),
    ):
        running = _active(windows, hour, prev_windows)
        if running:
            w[key] = jitter(running.watts)

    if plan.lights_on <= hour < plan.lights_off:
        w["lighting"] = jitter(140 * size)
    elif 5.75 <= hour < 7.0:
        w["lighting"] = jitter(50 * size)
    elif hour < 5.75 or hour >= plan.lights_off:
        w["lighting"] = jitter(8)  # a night light

    # Ceiling fans: every fan in the evening, one through the day and at night when the AC is off.
    if 17.0 <= hour < 24:
        w["fan"] = jitter(65 * plan.fans)
    elif 9.5 <= hour < 17.0 or not ac:
        w["fan"] = jitter(65)

    # Router, chargers and standby, plus short kitchen loads.
    other = plan.base_watts + 8 * math.sin(minute_of_day / 37)
    kitchen = _active(plan.kitchen, hour, prev.kitchen)
    if kitchen:
        other += kitchen.watts
    w["other"] = jitter(other)

    voltage = 231 + 2.5 * math.cos(2 * math.pi * (hour - 3) / 24) + noise.gauss(0, 0.8)

    fault = forced_fault or _active(plan.faults, hour, prev.faults)
    label = "normal"
    if fault:
        kind = fault.kind if isinstance(fault, Window) else fault
        label = kind
        if kind == "high_load_spike":
            w["other"] += fault.watts if isinstance(fault, Window) else noise.uniform(2500, 3500)
        elif kind == "baseload_leakage":
            w["other"] += fault.watts if isinstance(fault, Window) else noise.uniform(350, 550) * size
        elif kind == "voltage_fluctuation":
            voltage = fault.watts if isinstance(fault, Window) else noise.choice([noise.uniform(186, 200), noise.uniform(254, 262)])

    appliances = {k: round(v, 2) for k, v in w.items()}
    return {
        "meter_id": f"M{meter_number}",
        "timestamp": ts.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "total_power_w": round(sum(appliances.values()), 2),
        "voltage_v": round(voltage, 2),
        "appliances_w": appliances,
        "sim_label": label,
    }


def history(meters, days, seed, fault_rate):
    """One reading per minute per meter for the last `days` days, oldest first."""
    end = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    ts = end - timedelta(days=days)
    rng = random.Random(seed)
    while ts < end:
        for n in range(1, meters + 1):
            yield make_reading(n, ts, seed, fault_rate, noise=rng)
        ts += timedelta(minutes=1)


# ---------------------------------------------------------------------------
# Talking to the backend
# ---------------------------------------------------------------------------


def post(client, path, body):
    """POST until the backend accepts it. Network errors and 5xx are retried every
    RETRY_SECONDS, so a restarting backend never crashes the simulator. A 4xx means the
    data is wrong, so it is reported and skipped instead of retried forever."""
    while True:
        try:
            response = client.post(f"{BACKEND_URL}{path}", json=body)
        except httpx.RequestError as exc:
            print(f"Backend unavailable ({exc.__class__.__name__}). Retrying in {RETRY_SECONDS} s", flush=True)
            time.sleep(RETRY_SECONDS)
            continue
        if response.status_code >= 500:
            print(f"Backend returned HTTP {response.status_code}. Retrying in {RETRY_SECONDS} s", flush=True)
            time.sleep(RETRY_SECONDS)
            continue
        if response.status_code >= 400:
            print(f"Backend rejected {path}: HTTP {response.status_code} {response.text}", flush=True)
            return None
        return response.json()


def post_batch(client, batch):
    """Send one backfill batch exactly once. A small server can take a while to score 500
    readings, so the wait is long. If the connection still fails, the batch may have been
    saved anyway, so check the newest reading of each meter before sending it again."""
    while True:
        try:
            response = client.post(
                f"{BACKEND_URL}/readings/batch?backfill=true", json={"readings": batch}, timeout=600
            )
        except httpx.RequestError as exc:
            print(f"Backend unavailable ({exc.__class__.__name__}). Checking before retrying ...", flush=True)
            time.sleep(RETRY_SECONDS * 2)
            if batch_saved(client, batch):
                return {"alerts_created": 0}
            continue
        if response.status_code >= 500:
            print(f"Backend returned HTTP {response.status_code}. Retrying in {RETRY_SECONDS} s", flush=True)
            time.sleep(RETRY_SECONDS)
            continue
        if response.status_code >= 400:
            print(f"Backend rejected a batch: HTTP {response.status_code} {response.text}", flush=True)
            return None
        return response.json()


def batch_saved(client, batch):
    """True when every meter's newest saved reading is at or after its last one in the batch."""
    last = {r["meter_id"]: r["timestamp"] for r in batch}  # batches are oldest first
    for meter_id, timestamp in last.items():
        try:
            response = client.get(f"{BACKEND_URL}/readings/latest", params={"meter_id": meter_id})
        except httpx.RequestError:
            return False
        if response.status_code != 200 or response.json()["timestamp"] < timestamp:
            return False
    return True


def backend_has_meters(client):
    while True:
        try:
            response = client.get(f"{BACKEND_URL}/meters")
            if response.status_code == 200:
                return bool(response.json())
            print(f"GET /meters returned HTTP {response.status_code}. Retrying in {RETRY_SECONDS} s", flush=True)
        except httpx.RequestError as exc:
            print(f"Backend unavailable ({exc.__class__.__name__}). Retrying in {RETRY_SECONDS} s", flush=True)
        time.sleep(RETRY_SECONDS)


def backfill(client, args, days):
    print(f"Backfilling {days} days for {args.meters} meters, one reading per minute ...", flush=True)
    batch, sent, alerts, started = [], 0, 0, time.monotonic()

    def flush():
        nonlocal batch, sent, alerts
        if not batch:
            return
        if not args.no_send:
            result = post_batch(client, batch)
            if result is None:
                raise SystemExit("Backfill stopped: the backend rejected a batch (see above).")
            alerts += result["alerts_created"]
        sent += len(batch)
        batch = []
        if sent % 25_000 < BATCH_SIZE:
            print(f"  {sent:,} readings, {time.monotonic() - started:.0f} s", flush=True)

    for reading in history(args.meters, days, args.seed, args.fault_rate):
        batch.append(reading)
        if len(batch) == BATCH_SIZE:
            flush()
    flush()
    print(f"Backfill done: {sent:,} readings, {alerts} alerts (saved as acknowledged).", flush=True)


# ---------------------------------------------------------------------------
# Live mode and demo faults
# ---------------------------------------------------------------------------


def read_injections():
    try:
        with open(CONTROL_FILE) as f:
            entries = json.load(f)
    except (OSError, ValueError):
        return {}
    now = time.time()
    return {m: e["type"] for m, e in entries.items() if e.get("until", 0) > now}


def queue_injection(meter_id, kind, minutes):
    entries = {}
    try:
        with open(CONTROL_FILE) as f:
            entries = json.load(f)
    except (OSError, ValueError):
        pass
    entries[meter_id] = {"type": kind, "until": time.time() + minutes * 60}
    tmp = f"{CONTROL_FILE}.tmp"
    with open(tmp, "w") as f:
        json.dump(entries, f)
    os.replace(tmp, CONTROL_FILE)


def live_simulator_running():
    try:
        return time.time() - os.path.getmtime(ALIVE_FILE) < 30
    except OSError:
        return False


def live(client, args, forced=None):
    deadline = time.monotonic() + args.duration if args.duration else None
    output = open(args.output, "a", encoding="utf-8") if args.output else None
    next_tick = time.monotonic()
    last_log, count = 0.0, 0
    print(f"Live: {args.meters} meters every {args.interval:g} s -> {BACKEND_URL}/readings", flush=True)
    while deadline is None or time.monotonic() < deadline:
        try:
            with open(ALIVE_FILE, "w") as f:
                f.write(str(os.getpid()))
            injected = {**read_injections(), **(forced or {})}
            now = datetime.now(timezone.utc).replace(microsecond=0)
            latest = []
            for n in range(1, args.meters + 1):
                reading = make_reading(n, now, args.seed, args.fault_rate, injected.get(f"M{n}"))
                if output:
                    output.write(json.dumps(reading) + "\n")
                    output.flush()
                if not args.no_send:
                    post(client, "/readings", reading)
                latest.append(f"{reading['meter_id']} {reading['total_power_w'] / 1000:.2f} kW"
                              + ("" if reading["sim_label"] == "normal" else f" [{reading['sim_label']}]"))
                count += 1
            if time.monotonic() - last_log >= 60:
                print(f"{now:%H:%M:%S}Z sent {count} readings so far; now: {', '.join(latest)}", flush=True)
                last_log = time.monotonic()
        except Exception as exc:  # the simulator never crashes; it reports and keeps going
            print(f"Live loop error: {exc!r}", flush=True)
        next_tick += args.interval
        time.sleep(max(0.0, next_tick - time.monotonic()))
    if output:
        output.close()


# ---------------------------------------------------------------------------
# CSV export for training (contract 6.3: appliance values as appliances_w.ac etc.)
# ---------------------------------------------------------------------------


def export_csv(path, args):
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    fields = ["meter_id", "timestamp", "total_power_w", "voltage_v",
              *[f"appliances_w.{a}" for a in APPLIANCES], "sim_label"]
    rows = 0
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for r in history(args.meters, args.days, args.seed, args.fault_rate):
            row = {k: r[k] for k in ("meter_id", "timestamp", "total_power_w", "voltage_v", "sim_label")}
            row.update({f"appliances_w.{a}": r["appliances_w"][a] for a in APPLIANCES})
            writer.writerow(row)
            rows += 1
    print(f"Exported {rows:,} readings to {path}. Nothing was sent to the backend.")


def main():
    parser = argparse.ArgumentParser(description="EnergyGuard smart meter simulator")
    parser.add_argument("--meters", type=int, default=int(os.getenv("SIM_METER_COUNT", "3")))
    parser.add_argument("--interval", type=float, default=float(os.getenv("SIM_INTERVAL_SECONDS", "5")))
    parser.add_argument("--duration", type=float, default=0, help="seconds of live mode; 0 runs until stopped")
    parser.add_argument("--fault-rate", type=float, default=1.0, help="fault episodes per meter per day")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", help="also append each live reading to this JSONL file")
    parser.add_argument("--no-send", action="store_true", help="generate readings without sending them")
    parser.add_argument("--inject", choices=FAULT_TYPES, help="force a fault on --meter right now")
    parser.add_argument("--meter", help="meter for --inject, e.g. M1")
    parser.add_argument("--minutes", type=float, default=3, help="how long an injected fault lasts")
    parser.add_argument("--backfill-days", type=int, help="send this many days of history, then exit")
    parser.add_argument("--auto-backfill-days", type=int, default=0,
                        help="live mode: first send this much history if the backend has no meters yet")
    parser.add_argument("--export-csv", help="write history to this CSV for model training, then exit")
    parser.add_argument("--days", type=int, default=30, help="days of history for --export-csv")
    args = parser.parse_args()

    if args.meters < 1:
        parser.error("--meters must be at least 1")
    if args.interval <= 0 or args.duration < 0:
        parser.error("--interval must be positive and --duration not negative")
    if (args.inject is None) != (args.meter is None):
        parser.error("--inject and --meter must be used together")
    if args.meter and args.meter not in {f"M{n}" for n in range(1, args.meters + 1)}:
        parser.error(f"--meter must be one of M1 to M{args.meters}")
    if args.backfill_days is not None and args.backfill_days <= 0:
        parser.error("--backfill-days must be positive")
    if args.backfill_days and args.export_csv:
        parser.error("choose either --backfill-days or --export-csv")

    if args.export_csv:
        export_csv(args.export_csv, args)
        return

    if args.inject and live_simulator_running():
        queue_injection(args.meter, args.inject, args.minutes)
        print(f"{args.inject} on {args.meter} for {args.minutes:g} min: the running simulator applies it within seconds.")
        return

    with httpx.Client(timeout=30.0) as client:
        if args.backfill_days:
            backfill(client, args, args.backfill_days)
            return
        if args.inject:
            # No live simulator to signal, so run one ourselves with the fault for its duration.
            args.duration = args.duration or args.minutes * 60
            live(client, args, forced={args.meter: args.inject})
            return
        if args.auto_backfill_days and not args.no_send and not backend_has_meters(client):
            backfill(client, args, args.auto_backfill_days)
        live(client, args)


if __name__ == "__main__":
    main()
