from __future__ import annotations

import csv
import io
import json
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import requests

CONSTITUENTS_URL = "https://www.niftyindices.com/IndexConstituent/ind_nifty200list.csv"


@dataclass(frozen=True)
class Nifty200Constituents:
    symbols: tuple[str, ...]
    source: str


class Nifty200Service:
    def __init__(self, cache_path: Path, cache_seconds: int = 43_200) -> None:
        self.cache_path = cache_path
        self.packaged_path = Path(__file__).resolve().parent / "assets" / "nifty200.json"
        self.cache_seconds = cache_seconds
        self._value: Nifty200Constituents | None = None
        self._cached_at = 0.0
        self._lock = threading.RLock()

    def get(self, force_refresh: bool = False) -> Nifty200Constituents:
        with self._lock:
            if (
                not force_refresh
                and self._value is not None
                and time.monotonic() - self._cached_at < self.cache_seconds
            ):
                return self._value
        try:
            result = Nifty200Constituents(self._download(), "NSE Indices")
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(
                json.dumps({"symbols": result.symbols}), encoding="utf-8"
            )
        except Exception:
            symbols, source = self._fallback_symbols()
            result = Nifty200Constituents(symbols, source)
        with self._lock:
            self._value = result
            self._cached_at = time.monotonic()
        return result

    @staticmethod
    def _validate(symbols: tuple[str, ...]) -> tuple[str, ...]:
        if len(symbols) != 200:
            raise ValueError(f"Expected 200 Nifty constituents, received {len(symbols)}.")
        if any(not symbol or len(symbol) > 40 for symbol in symbols):
            raise ValueError("The Nifty 200 file contains an invalid symbol.")
        return symbols

    def _download(self) -> tuple[str, ...]:
        response = requests.get(
            CONSTITUENTS_URL,
            headers={
                "User-Agent": "Mozilla/5.0 Trade-M2/1.0",
                "Accept": "text/csv,*/*",
            },
            timeout=20,
        )
        response.raise_for_status()
        rows = csv.DictReader(io.StringIO(response.content.decode("utf-8-sig")))
        symbols = tuple(
            dict.fromkeys(
                str(row.get("Symbol", "")).strip().upper()
                for row in rows
                if str(row.get("Symbol", "")).strip()
            )
        )
        return self._validate(symbols)

    def _fallback_symbols(self) -> tuple[tuple[str, ...], str]:
        for path, source in (
            (self.cache_path, "local cache"),
            (self.packaged_path, "packaged snapshot (2026-09-20)"),
        ):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                symbols = tuple(
                    str(value).strip().upper() for value in payload["symbols"]
                )
                return self._validate(symbols), source
            except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
                continue
        raise RuntimeError(
            "The official Nifty 200 list is unavailable and no valid fallback exists."
        )
