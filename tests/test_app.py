from pathlib import Path

from fastapi.testclient import TestClient

from trade_m2.app import build_app
from trade_m2.config import Settings


def settings(tmp_path: Path, configured: bool = False) -> Settings:
    return Settings(
        upstox_api_key="key" if configured else "",
        upstox_api_secret="secret" if configured else "",
        upstox_redirect_url="http://127.0.0.1:8000/auth/upstox/callback",
        host="127.0.0.1",
        port=8000,
        database_path=tmp_path / "api.db",
    )


def test_dashboard_and_unauthenticated_status(tmp_path):
    with TestClient(build_app(settings(tmp_path))) as client:
        assert client.get("/").status_code == 200
        status = client.get("/api/status").json()
        assert status["configured"] is False
        assert status["authenticated"] is False
        assert status["rule_count"] == 0


def test_load_requires_upstox_login(tmp_path):
    with TestClient(build_app(settings(tmp_path, configured=True))) as client:
        response = client.post("/api/nifty200/load", json={"percentage": "1.5"})
        assert response.status_code == 401


def test_oauth_login_redirect_contains_state(tmp_path):
    with TestClient(build_app(settings(tmp_path, configured=True))) as client:
        response = client.get("/auth/upstox/login", follow_redirects=False)
        assert response.status_code in {302, 307}
        location = response.headers["location"]
        assert "api.upstox.com/v2/login/authorization/dialog" in location
        assert "state=" in location
