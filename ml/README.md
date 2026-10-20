# EnergyGuard - ML (`/ml`)

Anomaly detection for smart-meter readings. Backend calls `score_reading(reading, recent)` and gets an AnomalyResult.

## Quick start
```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
python -m ipykernel install --user --name energyguard-ml
jupyter notebook          # open notebooks/01_eda -> 02_train -> 03_evaluate, kernel: energyguard-ml
pytest tests              # contract tests (use MODEL_PATH=models/model.pkl if you set a custom model)
```
No simulator CSV yet? Notebook 01 creates a stand-in (`data/synthetic_30d.csv`). Train the final model on the real export.

## How it works
1. `features.py` - one function builds the same features for training and live scoring.
2. `training.py` - Isolation Forest trained on normal rows; score calibrated so 0.5 = 99.9th percentile of held-out normal data; thresholds for the fault-type rules are learned from normal data.
3. `inference.py` - model score + rules -> `is_anomaly`, `anomaly_type`, `score`, `severity`, `model_version`.
4. `evaluation.py` - compares predictions with `sim_label` (used only for marking answers).

## Tuning
`THRESH_PCT` (notebook 02 / `--threshold-pct`): lower = more alerts, higher = fewer false alarms.
