from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Index, Integer, String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.types import TypeDecorator


class UTCDateTime(TypeDecorator):
    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return value.astimezone(UTC) if value else value

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value


class Base(DeclarativeBase):
    pass


class MeterRow(Base):
    __tablename__ = "meters"

    meter_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    last_seen: Mapped[datetime] = mapped_column(UTCDateTime)


class ReadingRow(Base):
    __tablename__ = "readings"
    __table_args__ = (Index("ix_readings_meter_timestamp", "meter_id", "timestamp"),)

    reading_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    meter_id: Mapped[str] = mapped_column(ForeignKey("meters.meter_id"))
    timestamp: Mapped[datetime] = mapped_column(UTCDateTime)
    total_power_w: Mapped[float] = mapped_column(Float)
    voltage_v: Mapped[float | None] = mapped_column(Float)
    appliances_w: Mapped[dict] = mapped_column(JSON)
    sim_label: Mapped[str | None] = mapped_column(String(40))


class AlertRow(Base):
    __tablename__ = "alerts"
    __table_args__ = (
        Index("ix_alerts_merge", "meter_id", "anomaly_type", "status", "last_seen_at"),
    )

    alert_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    meter_id: Mapped[str] = mapped_column(ForeignKey("meters.meter_id"))
    reading_id: Mapped[int] = mapped_column(ForeignKey("readings.reading_id"))
    timestamp: Mapped[datetime] = mapped_column(UTCDateTime)
    last_seen_at: Mapped[datetime] = mapped_column(UTCDateTime)
    occurrence_count: Mapped[int] = mapped_column(Integer)
    anomaly_type: Mapped[str] = mapped_column(String(40))
    severity: Mapped[str] = mapped_column(String(10))
    score: Mapped[float] = mapped_column(Float)
    total_power_w: Mapped[float] = mapped_column(Float)
    peak_power_w: Mapped[float] = mapped_column(Float)
    message: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(20))
    note: Mapped[str | None] = mapped_column(String(2000))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime)


class Database:
    def __init__(self, url: str):
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        options = {"check_same_thread": False} if url.startswith("sqlite") else {}
        self.engine = create_engine(url, pool_pre_ping=True, connect_args=options)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)
