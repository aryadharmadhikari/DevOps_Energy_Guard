import asyncio
import json
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

from starlette.requests import Request


@dataclass(eq=False)
class Subscription:
    meter_id: str
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=256))
    overflowed: bool = False


class EventBroker:
    def __init__(self):
        self.subscriptions: set[Subscription] = set()

    @asynccontextmanager
    async def subscribe(self, meter_id: str):
        subscription = Subscription(meter_id)
        self.subscriptions.add(subscription)
        try:
            yield subscription
        finally:
            self.subscriptions.discard(subscription)

    def publish(self, meter_id: str, event: str, data: dict):
        payload = f"event: {event}\ndata: {json.dumps(data, allow_nan=False)}\n\n"
        for subscription in tuple(self.subscriptions):
            if subscription.meter_id != meter_id:
                continue
            try:
                subscription.queue.put_nowait(payload)
            except asyncio.QueueFull:
                # End slow connections. EventSource reconnects and the UI can fetch snapshots.
                subscription.overflowed = True

    async def stream(self, meter_id: str, request: Request):
        async with self.subscribe(meter_id) as subscription:
            yield ": connected\n\n"
            while not subscription.overflowed and not await request.is_disconnected():
                try:
                    yield await asyncio.wait_for(subscription.queue.get(), timeout=15)
                except TimeoutError:
                    yield ": heartbeat\n\n"
