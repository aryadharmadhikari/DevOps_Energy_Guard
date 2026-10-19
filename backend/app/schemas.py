from datetime import UTC, datetime
from enum import StrEnum
from math import isclose
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_serializer,
    model_validator,
)

Power = Annotated[float, Field(ge=0, allow_inf_nan=False, strict=True)]
MeterId = Annotated[str, Field(pattern=r"^M[1-9][0-9]*$", max_length=32)]
Severity = Literal["low", "medium", "high"]
AlertStatus = Literal["open", "acknowledged", "false_alarm"]


class AnomalyType(StrEnum):
    NONE = "none"
    BASELOAD_LEAKAGE = "baseload_leakage"
    HIGH_LOAD_SPIKE = "high_load_spike"
    VOLTAGE_FLUCTUATION = "voltage_fluctuation"
    STATISTICAL_OUTLIER = "statistical_outlier"


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    @field_serializer("*", check_fields=False, when_used="json")
    def serialize_utc(self, value):
        if isinstance(value, datetime):
            return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
        return value


class Health(ContractModel):
    status: Literal["ok"]


class ErrorDetail(ContractModel):
    code: str
    message: str


class ErrorResponse(ContractModel):
    error: ErrorDetail


class Appliances(ContractModel):
    ac: Power
    fridge: Power
    geyser: Power
    washing_machine: Power
    lighting: Power
    fan: Power
    tv: Power
    other: Power


class ReadingInput(ContractModel):
    meter_id: MeterId
    timestamp: AwareDatetime
    total_power_w: Power
    voltage_v: Power | None
    appliances_w: Appliances
    sim_label: (
        Literal[
            "normal",
            "none",
            "baseload_leakage",
            "high_load_spike",
            "voltage_fluctuation",
            "statistical_outlier",
        ]
        | None
    ) = None

    @model_validator(mode="after")
    def validate_total(self):
        total = sum(self.appliances_w.model_dump().values())
        if not isclose(self.total_power_w, total, rel_tol=1e-9, abs_tol=1e-6):
            raise ValueError("total_power_w must equal the sum of all eight appliances_w values")
        self.timestamp = self.timestamp.astimezone(UTC)
        return self


class Reading(ReadingInput):
    reading_id: int


class AnomalyResult(ContractModel):
    is_anomaly: bool
    anomaly_type: AnomalyType
    score: Annotated[float, Field(ge=0, le=1, allow_inf_nan=False)]
    severity: Severity | None
    model_version: str

    @model_validator(mode="after")
    def validate_classification(self):
        if self.is_anomaly != (self.score >= 0.5):
            raise ValueError("is_anomaly must match score >= 0.5")
        if not self.is_anomaly:
            if self.anomaly_type != AnomalyType.NONE or self.severity is not None:
                raise ValueError("Normal results require anomaly_type none and severity null")
        else:
            expected = "high" if self.score > 0.8 else "medium" if self.score >= 0.6 else "low"
            if self.anomaly_type == AnomalyType.NONE or self.severity != expected:
                raise ValueError("Anomaly type and severity must match the score")
        return self


class IngestResult(ContractModel):
    reading: Reading
    anomaly: AnomalyResult


class BatchInput(ContractModel):
    readings: Annotated[list[ReadingInput], Field(min_length=1, max_length=500)]

    @model_validator(mode="after")
    def validate_order(self):
        timestamps = [reading.timestamp for reading in self.readings]
        if timestamps != sorted(timestamps):
            raise ValueError("Batch readings must be oldest first")
        return self


class BatchResult(ContractModel):
    saved: int
    alerts_created: int


class Alert(ContractModel):
    alert_id: int
    meter_id: str
    reading_id: int
    timestamp: AwareDatetime
    last_seen_at: AwareDatetime
    occurrence_count: int
    anomaly_type: AnomalyType
    severity: Severity
    score: float
    total_power_w: float
    peak_power_w: float
    message: str
    status: AlertStatus
    note: str | None
    created_at: AwareDatetime
    updated_at: AwareDatetime


class AlertUpdate(ContractModel):
    # Validated in the endpoint so a bad status returns the contract's HTTP 400.
    status: str
    note: Annotated[str, Field(max_length=2000)] | None = None


class Meter(ContractModel):
    meter_id: str
    name: str
    last_seen: AwareDatetime


class HistoryBucket(ContractModel):
    bucket_start: AwareDatetime
    avg_power_w: float | None = None
    max_power_w: float | None = None
    energy_kwh: float | None = None
    appliances_kwh: dict[str, float] | None = None
    alert_count: int | None = None


class History(ContractModel):
    meter_id: str
    range: Literal["24h", "7d", "30d"]
    buckets: list[HistoryBucket]
