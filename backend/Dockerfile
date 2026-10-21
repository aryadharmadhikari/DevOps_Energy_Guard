# Trains the anomaly model from code, so no model file is kept in Git and every build
# (laptop, Jenkins, AWS) gets the same one: simulator history -> Ameya's training CLI.
# Same pinned backend requirements as the runtime, so model.pkl loads (contract section 2).
FROM python:3.12-slim AS model
WORKDIR /build
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY backend/requirements.txt /build/requirements.txt
RUN pip install --no-cache-dir -r /build/requirements.txt pandas
COPY ml /build/ml
RUN pip install --no-cache-dir /build/ml
COPY simulator/simulator.py /build/simulator.py
RUN python simulator.py --export-csv /build/sim.csv --days 60 \
    && python -m energyguard_ml.training --csv /build/sim.csv --out /build/model.pkl --threshold-pct 99.97

FROM python:3.12-slim AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt
COPY ml /app/ml
RUN if [ -f /app/ml/pyproject.toml ]; then pip install --no-cache-dir /app/ml; fi
COPY backend /app/backend
WORKDIR /app/backend

FROM base AS test
RUN pip install --no-cache-dir -r requirements-dev.txt
CMD ["sh", "-c", "ruff check . && ruff format --check . && pytest -q"]

FROM base AS runtime
COPY --from=model /build/model.pkl /app/ml/models/model.pkl
RUN useradd --create-home energyguard
USER energyguard
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000 --workers 1"]
