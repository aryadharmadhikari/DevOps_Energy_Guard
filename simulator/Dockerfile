# EnergyGuard meter simulator (contract section 6.3).
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY simulator.py test_simulator.py ./
RUN useradd --create-home simulator
USER simulator
# Live mode. On a fresh database it first sends 30 days of history (contract 6.3 backfill),
# so `docker compose up` gives full charts without a separate step.
CMD ["python", "simulator.py", "--auto-backfill-days", "30"]
