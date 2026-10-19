from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool

from app.errors import ApiError
from app.history import RANGES
from app.schemas import (
    Alert,
    AlertUpdate,
    BatchInput,
    BatchResult,
    ErrorResponse,
    Health,
    History,
    IngestResult,
    Meter,
    Reading,
    ReadingInput,
)

router = APIRouter(
    prefix="/api/v1",
    responses={code: {"model": ErrorResponse} for code in (400, 404, 422, 500)},
)


@router.get("/health", response_model=Health)
def health(request: Request):
    with request.app.state.database.engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return {"status": "ok"}


@router.post("/readings", response_model=IngestResult, status_code=201)
async def ingest(reading: ReadingInput, request: Request, tasks: BackgroundTasks):
    results = await save_and_publish(request, [reading], False, tasks)
    return results[0].result


@router.post("/readings/batch", response_model=BatchResult, status_code=201)
async def ingest_batch(
    batch: BatchInput,
    request: Request,
    tasks: BackgroundTasks,
    backfill: bool = False,
):
    results = await save_and_publish(request, batch.readings, backfill, tasks)
    return BatchResult(saved=len(results), alerts_created=sum(row.alert_created for row in results))


@router.get("/meters", response_model=list[Meter])
def meters(request: Request):
    return request.app.state.service.meters()


@router.get("/readings/latest", response_model=Reading)
def latest(request: Request, meter_id: str):
    return request.app.state.service.latest(meter_id)


@router.get("/readings/history", response_model=History)
def history(request: Request, meter_id: str, range: str = "24h"):
    if range not in RANGES:
        raise ApiError(400, "invalid_range", "range must be 24h, 7d or 30d")
    return request.app.state.history.get(meter_id, range)


@router.get("/alerts", response_model=list[Alert])
def alerts(
    request: Request,
    meter_id: str | None = None,
    status: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
):
    if status is not None and status not in {"open", "acknowledged", "false_alarm"}:
        raise ApiError(400, "invalid_status", "status must be open, acknowledged or false_alarm")
    return request.app.state.service.alerts(meter_id, status, limit)


@router.patch("/alerts/{alert_id}", response_model=Alert)
async def update_alert(alert_id: int, update: AlertUpdate, request: Request):
    if update.status not in {"acknowledged", "false_alarm"}:
        raise ApiError(400, "invalid_status", "status must be acknowledged or false_alarm")
    state = request.app.state
    async with state.write_lock:
        alert = await run_in_threadpool(state.service.update_alert, alert_id, update)
        state.broker.publish(alert.meter_id, "alert", alert.model_dump(mode="json"))
    return alert


@router.get("/stream", response_class=StreamingResponse)
async def stream(request: Request, meter_id: str):
    await run_in_threadpool(request.app.state.service.latest, meter_id)
    return StreamingResponse(
        request.app.state.broker.stream(meter_id, request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def save_and_publish(request, readings, backfill, tasks):
    state = request.app.state
    # The contract fixes one worker. Serialize writes and publication to avoid merge races.
    async with state.write_lock:
        results = await run_in_threadpool(state.service.ingest, readings, backfill)
        for saved in results:
            state.readings_counter.inc()
            if saved.alert_created:
                state.alerts_counter.labels(anomaly_type=saved.alert.anomaly_type).inc()
            if backfill:
                continue
            state.broker.publish(
                saved.result.reading.meter_id,
                "reading",
                saved.result.model_dump(mode="json"),
            )
            if saved.alert:
                state.broker.publish(
                    saved.alert.meter_id,
                    "alert",
                    saved.alert.model_dump(mode="json"),
                )
            if saved.alert_created:
                tasks.add_task(state.notifier.notify, saved.alert)
    return results
