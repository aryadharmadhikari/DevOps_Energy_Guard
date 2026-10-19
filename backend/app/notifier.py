import asyncio
import logging

import httpx

from app.schemas import Alert

logger = logging.getLogger(__name__)


class Notifier:
    def __init__(self, url: str, client: httpx.AsyncClient):
        self.url = url.rstrip("/") + "/notify"
        self.client = client

    async def notify(self, alert: Alert):
        try:
            async with asyncio.timeout(2):
                response = await self.client.post(
                    self.url,
                    json=alert.model_dump(mode="json"),
                    timeout=2.0,
                )
            response.raise_for_status()
        except (httpx.HTTPError, TimeoutError):
            logger.warning("Notifier unavailable for saved alert %s", alert.alert_id, exc_info=True)
