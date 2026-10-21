#!/bin/sh
# CD: move the AWS server to the latest main, rebuild what changed, then check it answers.
# Usage: sh infra/deploy.sh <server-ip> <ssh-key-file>     (Jenkins runs this after a merge to main)
set -eu
host="$1"
key="$2"

ssh -i "$key" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "ubuntu@$host" '
  set -eu
  cd /opt/energyguard
  git fetch --quiet origin main
  git reset --hard --quiet origin/main
  docker compose -f docker-compose.yml -f docker-compose.aws.yml --profile team --profile monitoring \
    up -d --build --remove-orphans
  docker image prune -f > /dev/null
'
# The dashboard and the API behind it must answer before the deploy counts as done.
curl -fsS --retry 30 --retry-delay 5 --retry-all-errors "http://$host/api/v1/health"
echo
echo "Deployed: http://$host"
