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
RUN useradd --create-home energyguard
USER energyguard
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000 --workers 1"]
