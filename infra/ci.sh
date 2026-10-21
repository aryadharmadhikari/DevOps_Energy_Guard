#!/bin/sh
# Infra checks. Jenkins runs this from infra/ ("Available teammate checks" stage).
set -eu

# Same Prometheus version as docker-compose.yml.
docker run --rm -v "$PWD/prometheus:/etc/prometheus:ro" --entrypoint promtool \
    prom/prometheus:v2.55.1 check config /etc/prometheus/prometheus.yml
