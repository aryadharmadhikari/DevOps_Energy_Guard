from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.config import Settings
from app.database import AlertRow, Database, MeterRow, ReadingRow
from app.errors import ApiError
from app.schemas import (
    Alert,
    AlertUpdate,
    AnomalyResult,
    IngestResult,
    Meter,
    Reading,
    ReadingInput,
)


@dataclass
class SavedReading:
    result: IngestResult
    alert: Alert | None
    alert_created: bool


class ReadingService:
    def __init__(self, database: Database, settings: Settings, scorer: Callable):
        self.database = database
        self.settings = settings
        self.scorer = scorer

    def ingest(self, readings: list[ReadingInput], backfill: bool) -> list[SavedReading]:
        results = []
        with self.database.sessions.begin() as session:
            for reading in readings:
                self._update_meter(session, reading)
                recent = self._recent(session, reading)
                row = ReadingRow(**reading.model_dump())
                session.add(row)
                session.flush()
                saved_reading = Reading.model_validate(row)
                payload = saved_reading.model_dump(mode="json", exclude={"sim_label"})
                anomaly = AnomalyResult.model_validate(self.scorer(payload, recent=recent))
                alert, created = self._save_alert(session, row, anomaly, backfill)
                results.append(
                    SavedReading(
                        result=IngestResult(reading=saved_reading, anomaly=anomaly),
                        alert=Alert.model_validate(alert) if alert else None,
                        alert_created=created,
                    )
                )
        return results

    def meters(self) -> list[Meter]:
        with self.database.sessions() as session:
            rows = session.scalars(select(MeterRow).order_by(MeterRow.meter_id)).all()
            return [Meter.model_validate(row) for row in rows]

    def latest(self, meter_id: str) -> Reading:
        with self.database.sessions() as session:
            self.require_meter(session, meter_id)
            row = session.scalar(
                select(ReadingRow)
                .where(ReadingRow.meter_id == meter_id)
                .order_by(ReadingRow.timestamp.desc(), ReadingRow.reading_id.desc())
                .limit(1)
            )
            return Reading.model_validate(row)

    def alerts(self, meter_id: str | None, status: str | None, limit: int) -> list[Alert]:
        with self.database.sessions() as session:
            query = select(AlertRow)
            if meter_id is not None:
                self.require_meter(session, meter_id)
                query = query.where(AlertRow.meter_id == meter_id)
            if status is not None:
                query = query.where(AlertRow.status == status)
            rows = session.scalars(
                query.order_by(
                    AlertRow.last_seen_at.desc(),
                    AlertRow.alert_id.desc(),
                ).limit(limit)
            ).all()
            return [Alert.model_validate(row) for row in rows]

    def update_alert(self, alert_id: int, update: AlertUpdate) -> Alert:
        with self.database.sessions.begin() as session:
            row = session.get(AlertRow, alert_id)
            if row is None:
                raise ApiError(404, "alert_not_found", f"No alert with id {alert_id}")
            row.status = update.status
            if "note" in update.model_fields_set:
                row.note = update.note
            row.updated_at = datetime.now(UTC)
            session.flush()
            return Alert.model_validate(row)

    @staticmethod
    def require_meter(session, meter_id: str):
        if session.get(MeterRow, meter_id) is None:
            raise ApiError(404, "meter_not_found", f"No meter with id {meter_id}")

    @staticmethod
    def _update_meter(session, reading: ReadingInput):
        meter = session.get(MeterRow, reading.meter_id)
        if meter is None:
            session.add(
                MeterRow(
                    meter_id=reading.meter_id,
                    name=f"Home {reading.meter_id[1:]}",
                    last_seen=reading.timestamp,
                )
            )
        elif reading.timestamp > meter.last_seen:
            meter.last_seen = reading.timestamp
        session.flush()

    @staticmethod
    def _recent(session, reading: ReadingInput) -> list[dict]:
        rows = session.scalars(
            select(ReadingRow)
            .where(
                ReadingRow.meter_id == reading.meter_id,
                ReadingRow.timestamp <= reading.timestamp,
            )
            .order_by(ReadingRow.timestamp.desc(), ReadingRow.reading_id.desc())
            .limit(60)
        ).all()
        return [
            Reading.model_validate(row).model_dump(mode="json", exclude={"sim_label"})
            for row in reversed(rows)
        ]

    def _save_alert(self, session, reading, anomaly, backfill) -> tuple[AlertRow | None, bool]:
        if not anomaly.is_anomaly:
            return None, False
        window = timedelta(minutes=self.settings.alert_merge_minutes)
        # Live readings merge into open alerts. Backfill follows the same merge rule (contract
        # section 5) but only into earlier backfill alerts, so it never changes a live incident.
        if backfill:
            same_kind = (AlertRow.status == "acknowledged", AlertRow.note == "backfill")
        else:
            same_kind = (AlertRow.status == "open",)
        row = session.scalar(
            select(AlertRow)
            .where(
                AlertRow.meter_id == reading.meter_id,
                AlertRow.anomaly_type == anomaly.anomaly_type,
                *same_kind,
                AlertRow.last_seen_at >= reading.timestamp - window,
                AlertRow.last_seen_at <= reading.timestamp,
            )
            .order_by(AlertRow.last_seen_at.desc(), AlertRow.alert_id.desc())
            .limit(1)
        )
        if row is None:
            row = self._new_alert(reading, anomaly, backfill)
            session.add(row)
            session.flush()
            return row, True
        row.last_seen_at = reading.timestamp
        row.occurrence_count += 1
        row.peak_power_w = max(row.peak_power_w, reading.total_power_w)
        if anomaly.score > row.score:
            row.score = anomaly.score
            row.severity = anomaly.severity
        row.updated_at = datetime.now(UTC)
        session.flush()
        return row, False

    @staticmethod
    def _new_alert(reading, anomaly, backfill) -> AlertRow:
        now = datetime.now(UTC)
        title = anomaly.anomaly_type.replace("_", " ").capitalize()
        return AlertRow(
            meter_id=reading.meter_id,
            reading_id=reading.reading_id,
            timestamp=reading.timestamp,
            last_seen_at=reading.timestamp,
            occurrence_count=1,
            anomaly_type=anomaly.anomaly_type,
            severity=anomaly.severity,
            score=anomaly.score,
            total_power_w=reading.total_power_w,
            peak_power_w=reading.total_power_w,
            message=f"{title} on {reading.meter_id}: {reading.total_power_w:g} W",
            status="acknowledged" if backfill else "open",
            note="backfill" if backfill else None,
            created_at=now,
            updated_at=now,
        )
