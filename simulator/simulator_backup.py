
#!/usr/bin/env python3

import os
import argparse
import json
import random
import time
from datetime import datetime, timezone

import httpx

APPLIANCES = [
    "ac",
    "fridge",
    "geyser",
    "washing_machine",
    "lighting",
    "fan",
    "tv",
    "other",
]

FAULT_TYPES = [
    "baseload_leakage",
    "high_load_spike",
    "voltage_fluctuation",
]

BACKEND_URL = os.getenv(
    "BACKEND_URL",
    "http://backend:8000/api/v1",
).rstrip("/")

RETRY_SECONDS = 5


def generate_reading(meter_number, rng, energy_state, fault=None):
    meter_id = f"M{meter_number}"
    hour = datetime.now(timezone.utc).hour

    if 0 <= hour < 6:
        ac_power = rng.uniform(0, 500)
        geyser_power = 0
        washing_power = 0
        lighting_power = rng.uniform(10, 60)
        fan_power = rng.uniform(0, 70)
        tv_power = 0

    elif 6 <= hour < 10:
        ac_power = rng.uniform(0, 1000)
        geyser_power = rng.uniform(500, 1500)
        washing_power = rng.uniform(0, 800)
        lighting_power = rng.uniform(20, 120)
        fan_power = rng.uniform(30, 100)
        tv_power = rng.uniform(0, 150)

    elif 10 <= hour < 17:
        ac_power = rng.uniform(800, 1800)
        geyser_power = rng.uniform(0, 500)
        washing_power = rng.uniform(0, 400)
        lighting_power = rng.uniform(10, 100)
        fan_power = rng.uniform(30, 100)
        tv_power = rng.uniform(0, 100)

    else:
        ac_power = rng.uniform(200, 1200)
        geyser_power = rng.uniform(0, 1000)
        washing_power = rng.uniform(0, 500)
        lighting_power = rng.uniform(50, 150)
        fan_power = rng.uniform(30, 100)
        tv_power = rng.uniform(50, 200)

    appliances_w = {
        "ac": round(ac_power, 2),
        "fridge": round(rng.uniform(80, 180), 2),
        "geyser": round(geyser_power, 2),
        "washing_machine": round(washing_power, 2),
        "lighting": round(lighting_power, 2),
        "fan": round(fan_power, 2),
        "tv": round(tv_power, 2),
        "other": round(rng.uniform(0, 200), 2),
    }

    voltage = rng.uniform(225, 235)

    if fault == "baseload_leakage":
        appliances_w["other"] = round(
            appliances_w["other"] + 500, 2
        )

    elif fault == "high_load_spike":
        appliances_w["ac"] = round(
            appliances_w["ac"] + 2500, 2
        )

    elif fault == "voltage_fluctuation":
        voltage = rng.choice([
            rng.uniform(180, 205),
            rng.uniform(250, 260),
        ])

    total_power = round(sum(appliances_w.values()), 2)

    return {
        "meter_id": meter_id,
        "timestamp": (
            datetime.now(timezone.utc)
            .isoformat(timespec="seconds")
            .replace("+00:00", "Z")
        ),
        "total_power_w": total_power,
        "voltage_v": round(voltage, 2),
        "appliances_w": appliances_w,
        "sim_label": fault or "normal",
    }


def send_reading(client, reading):
    """Send one reading, retrying transient backend failures."""
    url = f"{BACKEND_URL}/readings"

    while True:
        try:
            response = client.post(url, json=reading)

            # Retry temporary server errors.
            if response.status_code >= 500:
                print(
                    f"Backend returned HTTP {response.status_code}. "
                    f"Retrying in {RETRY_SECONDS} seconds..."
                )
                time.sleep(RETRY_SECONDS)
                continue

            # Do not retry invalid requests indefinitely.
            response.raise_for_status()

            print(
                f"Sent reading for {reading['meter_id']}: "
                f"HTTP {response.status_code}"
            )
            return True

        except httpx.RequestError as exc:
            print(
                f"Backend unavailable ({exc}). "
                f"Retrying in {RETRY_SECONDS} seconds..."
            )
            time.sleep(RETRY_SECONDS)

        except httpx.HTTPStatusError as exc:
            print(
                f"Backend rejected reading for "
                f"{reading['meter_id']}: "
                f"HTTP {exc.response.status_code} - "
                f"{exc.response.text}"
            )
            return False


def main():
    parser = argparse.ArgumentParser(
        description="EnergyGuard Smart Meter Simulator"
    )

    parser.add_argument(
        "--meters",
        type=int,
        default=int(os.getenv("SIM_METER_COUNT", "3")),
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=float(os.getenv("SIM_INTERVAL_SECONDS", "5")),
    )
    parser.add_argument("--duration", type=int, default=30)
    parser.add_argument("--fault-rate", type=float, default=0.05)
    parser.add_argument("--output", default="readings.jsonl")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--inject",
        choices=FAULT_TYPES,
        help="Fault type to inject into a specific meter",
    )
    parser.add_argument(
        "--meter",
        type=str,
        help="Meter ID for manual fault injection, such as M1",
    )
    parser.add_argument(
        "--no-send",
        action="store_true",
        help="Generate readings locally without sending to backend",
    )

    args = parser.parse_args()

    if args.meters < 1 or args.interval <= 0 or args.duration <= 0:
        parser.error("Meters, interval, and duration must be positive.")

    if not 0 <= args.fault_rate <= 1:
        parser.error("Fault rate must be between 0 and 1.")

    if (args.inject is None) != (args.meter is None):
        parser.error("--inject and --meter must be used together.")

    if args.meter is not None:
        valid_meter_ids = {
            f"M{number}" for number in range(1, args.meters + 1)
        }
        if args.meter not in valid_meter_ids:
            parser.error(
                f"Invalid meter ID '{args.meter}'. "
                f"Choose from M1 to M{args.meters}."
            )

    rng = random.Random(args.seed)
    total_readings = 0
    fault_readings = 0
    failed_readings = 0

    start = time.monotonic()
    next_reading = start

    # Create one reusable HTTP client for the simulation.
    with httpx.Client(timeout=10.0) as client:
        with open(args.output, "w", encoding="utf-8") as file:
            while time.monotonic() - start < args.duration:
                for meter_number in range(1, args.meters + 1):
                    meter_id = f"M{meter_number}"

                    if args.inject and meter_id == args.meter:
                        fault = args.inject
                    elif rng.random() < args.fault_rate:
                        fault = rng.choice(FAULT_TYPES)
                    else:
                        fault = None

                    reading = generate_reading(
                        meter_number, rng, {}, fault
                    )

                    # Save the reading locally first.
                    file.write(json.dumps(reading) + "\n")
                    file.flush()
                    total_readings += 1

                    if fault:
                        fault_readings += 1

                    # Send to the backend unless offline mode was selected.
                    if not args.no_send:
                        success = send_reading(client, reading)
                        if not success:
                            failed_readings += 1

                next_reading += args.interval
                time.sleep(max(0, next_reading - time.monotonic()))

    elapsed = time.monotonic() - start

    print("\nEnergyGuard Simulation Complete")
    print("--------------------------------")
    print(f"Meters simulated: {args.meters}")
    print(f"Runtime: {elapsed:.2f} seconds")
    print(f"Total readings generated: {total_readings}")
    print(f"Readings with injected faults: {fault_readings}")
    print(f"Readings rejected by backend: {failed_readings}")
    print(f"Output saved to: {args.output}")
    print(f"Backend URL: {BACKEND_URL}")
    print(f"Backend sending enabled: {not args.no_send}")

    if args.inject:
        print(f"Forced fault: {args.inject} on meter {args.meter}")


if __name__ == "__main__":
    main()
