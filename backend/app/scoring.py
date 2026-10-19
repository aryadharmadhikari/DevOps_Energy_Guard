import importlib
import logging
import os

from app.config import Settings

logger = logging.getLogger(__name__)


def load_scorer(settings: Settings):
    if settings.ml_scorer == "stub":
        logger.warning("ML_SCORER=stub: using the contract's temporary >3000 W scoring rule")
        return score_reading
    if settings.ml_scorer != "package":
        raise ValueError("ML_SCORER must be stub or package")
    os.environ["MODEL_PATH"] = settings.model_path
    # Import failures must stop startup rather than silently switch to the stub.
    return importlib.import_module("energyguard_ml.inference").score_reading


def score_reading(reading: dict, recent: list[dict] | None = None) -> dict:
    spike = reading["total_power_w"] > 3000
    return {
        "is_anomaly": spike,
        "anomaly_type": "high_load_spike" if spike else "none",
        "score": 0.9 if spike else 0.1,
        "severity": "high" if spike else None,
        "model_version": "stub",
    }
