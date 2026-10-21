#!/bin/sh
# Frontend checks. Jenkins runs this from frontend/ ("Available teammate checks" stage).
# Lint, type-check, tests and a production build, all on Node 22.
set -eu

if command -v docker >/dev/null 2>&1; then
    # Jenkins agents have Docker but not necessarily Node.
    docker build --target ci -t energyguard-frontend-ci .
    docker image rm energyguard-frontend-ci >/dev/null 2>&1 || true
else
    npm ci
    npm run lint
    npm test
    npm run build
fi
