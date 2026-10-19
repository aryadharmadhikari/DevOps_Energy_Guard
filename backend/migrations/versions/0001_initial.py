"""Create meters, readings, and alerts."""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "meters",
        sa.Column("meter_id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "readings",
        sa.Column("reading_id", sa.Integer(), primary_key=True),
        sa.Column("meter_id", sa.String(32), sa.ForeignKey("meters.meter_id"), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("total_power_w", sa.Float(), nullable=False),
        sa.Column("voltage_v", sa.Float()),
        sa.Column("appliances_w", sa.JSON(), nullable=False),
        sa.Column("sim_label", sa.String(40)),
    )
    op.create_index("ix_readings_meter_timestamp", "readings", ["meter_id", "timestamp"])
    op.create_table(
        "alerts",
        sa.Column("alert_id", sa.Integer(), primary_key=True),
        sa.Column("meter_id", sa.String(32), sa.ForeignKey("meters.meter_id"), nullable=False),
        sa.Column("reading_id", sa.Integer(), sa.ForeignKey("readings.reading_id"), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("occurrence_count", sa.Integer(), nullable=False),
        sa.Column("anomaly_type", sa.String(40), nullable=False),
        sa.Column("severity", sa.String(10), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("total_power_w", sa.Float(), nullable=False),
        sa.Column("peak_power_w", sa.Float(), nullable=False),
        sa.Column("message", sa.String(300), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("note", sa.String(2000)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_alerts_merge",
        "alerts",
        ["meter_id", "anomaly_type", "status", "last_seen_at"],
    )


def downgrade():
    op.drop_table("alerts")
    op.drop_table("readings")
    op.drop_table("meters")
