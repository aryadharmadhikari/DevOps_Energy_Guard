# AGENTS.md - EnergyGuard `/ml` (owner: Ameya)

You are helping build ONLY the `ml/` folder of EnergyGuard (Common Baseline v1.0, frozen).
Open **this `ml/` folder as the workspace**. The full contract is `CONTRACT.md` in the repo root.

## What this folder delivers
- Python 3.12 package `energyguard_ml` and a trained `models/model.pkl`.
- ONE public function the backend calls:
  `score_reading(reading: dict, recent: list[dict] | None = None) -> dict`  (in `energyguard_ml/inference.py`)

## Frozen contract (never change names, types, units or allowed values)
Input Reading: `meter_id` str, `timestamp` ISO-8601 UTC "...Z", `total_power_w` float W, `voltage_v` float V or null,
`appliances_w` = {ac, fridge, geyser, washing_machine, lighting, fan, tv, other} floats W, `sim_label` (NEVER use when scoring).
`recent` = last up to 60 readings of the same meter, oldest first.

Output AnomalyResult (exactly these keys):
`is_anomaly` bool; `anomaly_type` in {none, baseload_leakage, high_load_spike, voltage_fluctuation, statistical_outlier};
`score` float 0..1 (anomaly iff >= 0.5); `severity` low (0.5-0.6) | medium (0.6-0.8) | high (>0.8), null when not an anomaly;
`model_version` str. If not anomaly: `anomaly_type="none"`, `severity=None`.

## Hard rules
1. Features only from values every Reading has (total, voltage, hour/day-of-week, the 8 appliance values, rolling stats from `recent`).
   Training and inference MUST use the same `energyguard_ml/features.py:build_features`.
2. Model loads ONCE at import from env `MODEL_PATH` (default `/app/ml/models/model.pkl`). Missing file -> raise immediately.
3. No network calls, no database access inside `score_reading`. It never raises for a valid reading. Inference p95 < 50 ms.
4. Python 3.12, scikit-learn pinned to `==1.5.2` in `pyproject.toml` (must match backend). Do not upgrade it.
5. Training data = simulator CSV (`data/*.csv`, git-ignored). `energyguard_ml/synthetic.py` is only a stand-in.
   A CSV at a different cadence (1/min vs 5 s) must be a separate `source` so rolling windows never mix.
6. Do NOT edit other folders (`backend/`, `frontend/`, `simulator/`, `db/`, Jenkinsfile, docker files, CONTRACT.md).
   Do NOT add new fields, anomaly types, endpoints or dependencies outside `ml/pyproject.toml`.
   If the task seems to need a contract change: STOP and tell Ameya to raise it in the group.
7. Never commit secrets, `.env`, or `data/`. Commit messages start with `ml:`. Work on a branch `ameya/<topic>`.
8. The appliance values are simulated smart-plug / sub-meter data. EnergyGuard does not split a total reading into appliances.

## Layout
`energyguard_ml/{features,inference,training,evaluation,synthetic}.py`, `notebooks/01_eda|02_train|03_evaluate.ipynb`,
`tests/test_contract.py`, `models/model.pkl`.

## Commands (run from `ml/`)
```
python3.12 -m venv .venv && source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
python -m ipykernel install --user --name energyguard-ml
python -m energyguard_ml.training --csv data/sim_30d.csv --out models/model.pkl    # same as notebook 02
MODEL_PATH=models/model.pkl pytest tests                                            # contract tests
```

## Definition of done
- `pytest tests` passes; notebook 03 shows high fault-episode recall, low false alarms, latency_ms_p95 < 50.
- `pip install ./ml` in a clean venv, then `MODEL_PATH=ml/models/model.pkl python -c "from energyguard_ml.inference import score_reading"` works.
- `models/model.pkl` was trained with the pinned scikit-learn version, then committed.
