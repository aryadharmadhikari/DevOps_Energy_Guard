#!/bin/sh
# ML checks. Jenkins runs this from ml/ ("Available teammate checks" stage).
# Installs the package on Python 3.12 with the backend's scikit-learn pin and runs the
# contract tests (they train a small synthetic model when no model.pkl exists).
set -eu

docker build -t energyguard-ml-ci -f - . <<'EOF'
FROM python:3.12-slim
WORKDIR /ml
COPY . .
RUN pip install --no-cache-dir . pandas pytest
CMD ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"]
EOF
docker run --rm energyguard-ml-ci
docker image rm energyguard-ml-ci >/dev/null 2>&1 || true
