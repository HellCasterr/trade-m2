# Trade M2

Trade M2 is a Windows-friendly, local alert dashboard built exclusively for the
Upstox API. It monitors the official **Nifty 200** constituent list and implements
the exact **Case 2** price-crossing rules discussed for Point A and Point B.

It is an alerting and decision-support tool. It never places an order.

## Level calculation

For each stock, the reference is the final completed three-minute candle close of
the immediately preceding trading session. With percentage `P`:

```text
Point A (upper) = reference close × (1 + P / 100)
Point B (lower) = reference close × (1 - P / 100)
```

If the daily range percentage is left blank, the application calculates it from
the preceding completed India VIX session:

```text
P = previous India VIX close / 8.54400
```

All calculations use Python `Decimal`; the dashboard rounds prices to two decimals
only for display.

## Exact Case 2 state machine

The first market price received for the session fixes the stock's opening zone.
Crossings are evaluated on Upstox live ticks, so the alert is emitted at the
intersection and does not wait for a three-minute candle to close.

| Opening zone | Qualifying movement | Alert |
| --- | --- | --- |
| Between B and A | Cross Point A upward | **LONG** |
| Between B and A | Cross Point B downward | **SHORT** |
| Above Point A | Cross Point A downward | **LONG** |
| Below Point B | Cross Point B upward | **SHORT** |

Point A always maps to LONG and Point B always maps to SHORT. An exact open on a
boundary does not create an artificial opening alert; the first movement away from
the level establishes which side the market occupied.

The default is one Point A alert and one Point B alert per stock per trading day.
The opening zone, last price, and sent flags are stored in SQLite so dashboard
refreshes cannot duplicate an alert.
Reloading a stock with a different percentage or corrected reference value resets
that stock's Case 2 state and replaces its earlier same-day alerts, so stale
deduplication records cannot block the recalculated levels.

## Recovery and protective stop

Upstox V3 LTPC is used for live crossing detection. On a fresh login, a new
subscription, or a WebSocket reconnect, Trade M2 first requests today's completed
three-minute candles and queues incoming ticks until recovery finishes. Because
OHLC data cannot reveal intrabar order, an inside-open recovery candle that touched
both A and B is deliberately skipped instead of guessing which alert came first.
The daily-open quote is accepted only when its Upstox timestamp belongs to the
current trading date, preventing a pre-market start from treating yesterday's OHLC
as today's opening price.

Every alert includes an indicative stop on the protective side of the entry. It
uses a 14-candle three-minute ATR and recent 10-candle structure, with a fixed
`1.50 × ATR` fallback and a risk distance bounded from 0.35% to 3.00%. The stop is
not submitted to Upstox and is not a guarantee of execution.

## Nifty 200 universe

“Top 200” is implemented as the official Nifty 200 index constituents, not a
hand-maintained or arbitrarily ranked list. The current CSV is downloaded from NSE
Indices when the universe is loaded and cached locally for 12 hours. The program
requires exactly 200 unique symbols before starting a bulk load; if the source is
temporarily unavailable, it uses the last valid local cache and then a clearly
dated packaged snapshot as the final fallback.

The 200 rules are built in a background job so the dashboard remains responsive.
Each stock is resolved to an exact NSE cash-equity instrument through Upstox and
then subscribed in safe batches.

## Windows setup

Requirements:

- Windows 10 or 11
- Python 3.11 or newer
- An Upstox account with API access
- Chrome, Edge, or another browser supporting desktop notifications

1. Create an Upstox developer app and set its redirect URL to exactly:

   ```text
   http://127.0.0.1:8000/auth/upstox/callback
   ```

2. Download or clone this repository.
3. Double-click `setup_windows.bat`.
4. Copy your existing `.env` into this folder, or edit the generated `.env`:

   ```dotenv
   UPSTOX_API_KEY=your_real_api_key
   UPSTOX_API_SECRET=your_real_api_secret
   UPSTOX_REDIRECT_URL=http://127.0.0.1:8000/auth/upstox/callback
   APP_HOST=127.0.0.1
   APP_PORT=8000
   ```

   Extra variables for other brokers in an older `.env` are harmless and ignored.

5. Double-click `start_windows.bat`.
6. Select **Connect Upstox** and complete the daily OAuth login.
7. Select **Enable browser alerts** and approve the browser permission.
8. Select **Load Nifty 200**. Leave the percentage blank to use the VIX-derived
   value, or enter a positive percentage up to 10.
9. Keep the terminal and browser open during market hours.

The access token stays in process memory and is not written to disk. `.env`, cached
constituents, and the SQLite database are excluded from Git.

## Development

```powershell
py -3 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.venv\Scripts\python.exe -m pytest
.venv\Scripts\python.exe run.py
```

API documentation is available at <http://127.0.0.1:8000/api/docs> while running.

## Operational safety

- Alerts depend on broker market data, network connectivity, symbol resolution,
  and browser/Windows notification settings.
- The dashboard exposes feed connection, recovery, queued-tick, stale-feed, and
  subscription counts. A connected feed is marked stale after 45 seconds without a
  tick during market hours when active subscriptions exist.
- Browser alerts are backed by a persistent server-sent event stream. Reconnection
  backfill and database uniqueness prevent lost or duplicated UI notifications.
- Stops and entries are reference values. Gaps, fast markets, tick size, liquidity,
  and slippage can materially change execution.
- Case 2 is a mechanical signal definition, not proof of an edge. Paper trade and
  validate it out of sample before risking capital.

Upstox API documentation: <https://upstox.com/developer/api-documentation/>

NSE Indices Nifty 200: <https://www.niftyindices.com/indices/equity/broad-based-indices/NIFTY-200>
