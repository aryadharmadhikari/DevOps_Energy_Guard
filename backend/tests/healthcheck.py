"""Run inside the backend container after Compose starts it."""

import urllib.request

with urllib.request.urlopen("http://localhost:8000/api/v1/health", timeout=2) as response:
    assert response.status == 200
