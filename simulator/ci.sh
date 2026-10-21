#!/bin/sh
# Simulator checks. Jenkins runs this from simulator/ ("Available teammate checks" stage).
# Builds the image, runs the tests, then generates a few live readings without sending them.
set -eu

docker build -t energyguard-simulator-ci .
docker run --rm energyguard-simulator-ci python test_simulator.py
docker run --rm energyguard-simulator-ci python simulator.py --no-send --duration 1 --interval 0.5
docker image rm energyguard-simulator-ci >/dev/null 2>&1 || true
