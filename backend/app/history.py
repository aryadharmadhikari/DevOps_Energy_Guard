from datetime import UTC, datetime, timedelta

from sqlalchemy import Float, Integer, cast, func, select

from app.database import AlertRow, Database, ReadingRow
from app.schemas import Appliances, History, HistoryBucket
from app.service import ReadingService

RANGES = {"24h": (300, 288), "7d": (3600, 168), "30d": (86400, 30)}


class HistoryService:
    def __init__(self, database: Database):
        self.database = database

    def get(self, meter_id: str, range_name: str, now: datetime | None = None) -> History:
        now = now or datetime.now(UTC)
        seconds, count = RANGES[range_name]
        end_bucket = int(now.timestamp()) // seconds * seconds
        start = datetime.fromtimestamp(end_bucket - (count - 1) * seconds, UTC)
        with self.database.sessions() as session:
            ReadingService.require_meter(session, meter_id)
            powers = self._powers(session, meter_id, start, now, seconds)
            alerts = self._alerts(session, meter_id, start, now, seconds)
        buckets = []
        for index in range(count):
            bucket_start = start + timedelta(seconds=index * seconds)
            key = int(bucket_start.timestamp()) // seconds
            bucket = HistoryBucket(bucket_start=bucket_start)
            if key in powers:
                avg_power, max_power, *appliances = powers[key]
                duration = min(seconds, (now - bucket_start).total_seconds())
                factor = duration / 3_600_000
                bucket.avg_power_w = avg_power
                bucket.max_power_w = max_power
                bucket.energy_kwh = avg_power * factor
                bucket.appliances_kwh = {
                    name: value * factor
                    for name, value in zip(Appliances.model_fields, appliances, strict=True)
                }
                bucket.alert_count = alerts.get(key, 0)
            buckets.append(bucket)
        return History(meter_id=meter_id, range=range_name, buckets=buckets)

    def _powers(self, session, meter_id, start, now, seconds):
        bucket = self._bucket_expression(ReadingRow.timestamp, seconds)
        appliance_averages = [
            func.avg(cast(ReadingRow.appliances_w[name].as_string(), Float))
            for name in Appliances.model_fields
        ]
        rows = session.execute(
            select(
                bucket,
                func.avg(ReadingRow.total_power_w),
                func.max(ReadingRow.total_power_w),
                *appliance_averages,
            )
            .where(
                ReadingRow.meter_id == meter_id,
                ReadingRow.timestamp >= start,
                ReadingRow.timestamp <= now,
            )
            .group_by(bucket)
        ).all()
        return {int(row[0]): tuple(row[1:]) for row in rows}

    def _alerts(self, session, meter_id, start, now, seconds):
        bucket = self._bucket_expression(AlertRow.timestamp, seconds)
        rows = session.execute(
            select(bucket, func.count(AlertRow.alert_id))
            .where(
                AlertRow.meter_id == meter_id,
                AlertRow.timestamp >= start,
                AlertRow.timestamp <= now,
            )
            .group_by(bucket)
        ).all()
        return {int(key): count for key, count in rows}

    def _bucket_expression(self, column, seconds):
        if self.database.engine.dialect.name == "sqlite":
            return cast(cast(func.strftime("%s", column), Integer) / seconds, Integer)
        return func.floor(func.extract("epoch", column) / seconds)
