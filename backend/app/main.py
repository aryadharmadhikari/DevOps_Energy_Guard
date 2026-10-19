import asyncio
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import CollectorRegistry, Counter
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import text

from app.config import Settings
from app.database import Database
from app.errors import install_error_handlers
from app.history import HistoryService
from app.notifier import Notifier
from app.routes import router
from app.scoring import load_scorer
from app.service import ReadingService
from app.stream import EventBroker


def create_app(settings: Settings | None = None, scorer=None, notifier_transport=None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        database = Database(settings.database_url)
        try:
            # Migrations run before uvicorn. Do not silently create or alter production tables.
            with database.engine.connect() as connection:
                connection.execute(text("SELECT meter_id FROM meters LIMIT 0"))
            app.state.database = database
            app.state.service = ReadingService(database, settings, scorer or load_scorer(settings))
            app.state.history = HistoryService(database)
            app.state.write_lock = asyncio.Lock()
            app.state.broker = EventBroker()
            async with httpx.AsyncClient(transport=notifier_transport) as client:
                app.state.notifier = Notifier(settings.notifier_url, client)
                yield
        finally:
            database.engine.dispose()

    app = FastAPI(title="EnergyGuard API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["Content-Type"],
    )
    install_error_handlers(app)
    app.include_router(router)
    registry = CollectorRegistry()
    app.state.readings_counter = Counter(
        "energyguard_readings_total",
        "Readings committed to the database",
        registry=registry,
    )
    app.state.alerts_counter = Counter(
        "energyguard_alerts_total",
        "New alerts committed to the database",
        ["anomaly_type"],
        registry=registry,
    )
    Instrumentator(
        registry=registry,
        excluded_handlers=["/metrics"],
        should_ignore_untemplated=True,
    ).instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)
    return app
