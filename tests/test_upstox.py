from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace

from trade_m2 import upstox
from trade_m2.upstox import UpstoxGateway


class QuoteApi:
    payload = {}

    def __init__(self, _client):
        pass

    def get_market_quote_ohlc(self, interval, **kwargs):
        assert interval == "1d"
        assert kwargs["instrument_key"] == "NSE_EQ|ONE,NSE_EQ|STALE"
        return SimpleNamespace(data=self.payload)


def test_session_open_ignores_stale_ohlc(monkeypatch):
    today = date(2026, 9, 21)
    current = int(datetime(2026, 9, 21, 3, 45, tzinfo=UTC).timestamp() * 1000)
    stale = int(datetime(2026, 9, 18, 3, 45, tzinfo=UTC).timestamp() * 1000)
    QuoteApi.payload = {
        "one": {
            "instrument_token": "NSE_EQ|ONE",
            "live_ohlc": {"open": 101.25, "ts": current},
        },
        "stale": {
            "instrument_token": "NSE_EQ|STALE",
            "live_ohlc": {"open": 88.5, "ts": stale},
        },
    }
    monkeypatch.setattr(
        upstox,
        "_sdk",
        lambda: SimpleNamespace(MarketQuoteV3Api=QuoteApi),
    )
    gateway = UpstoxGateway("key", "secret", "callback")
    gateway.api_client = object()
    result = gateway.session_open_prices(
        ["NSE_EQ|ONE", "NSE_EQ|STALE"], today
    )
    assert result == {"NSE_EQ|ONE": Decimal("101.25")}
