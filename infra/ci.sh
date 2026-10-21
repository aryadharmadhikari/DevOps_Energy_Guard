#!/bin/sh
# Infra checks. Jenkins runs this from infra/ ("Available teammate checks" stage).
# Files are copied into images instead of mounted, so this also works when Jenkins
# itself runs in a container and talks to the host's Docker.
set -eu

# Prometheus config, with the same Prometheus version as docker-compose.yml.
docker build -q -t energyguard-infra-ci -f - . <<'DOCKERFILE'
FROM prom/prometheus:v2.55.1
COPY prometheus/prometheus.yml /etc/prometheus/prometheus.yml
DOCKERFILE
docker run --rm --entrypoint promtool energyguard-infra-ci check config /etc/prometheus/prometheus.yml
docker image rm energyguard-infra-ci >/dev/null 2>&1 || true

# Grafana dashboard JSON must parse, or Grafana skips it at start-up.
docker run --rm -i python:3.12-slim python -m json.tool < grafana/provisioning/dashboards/energyguard.json > /dev/null
echo "Grafana dashboard JSON is valid"
