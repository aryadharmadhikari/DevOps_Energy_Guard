from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
        extra="ignore",
    )

    database_url: str = "postgresql://energyguard:energyguard@db:5432/energyguard"
    notifier_url: str = "http://notifier:8100"
    cors_origins: str = "http://localhost:5173"
    model_path: str = "/app/ml/models/model.pkl"
    alert_merge_minutes: int = Field(default=10, gt=0)
    ml_scorer: str = "stub"

    @property
    def origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
