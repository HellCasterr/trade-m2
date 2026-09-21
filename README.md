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
9. Keep the terminal open during market hours. Keep the browser open for desktop
   notifications; configured Telegram delivery also works with the browser closed.

The access token stays in process memory and is not written to disk. `.env`, cached
constituents, and the SQLite database are excluded from Git.

## Telegram alerts for two people

One bot sends every new Case 2 alert to both configured chats. Each message identifies
**Trade M2**, the stock, LONG/SHORT, Point A/B, crossing direction, reference entry,
indicative **stock-price** stop, original IST timestamp, and live/recovery source.
These values are not option-premium targets or stops. Existing Case 2 rules are unchanged.

1. Create your bot through [@BotFather](https://t.me/BotFather) using `/newbot`.
2. **Both people must open the new bot's chat and tap Start** (or send `/start`).
3. Obtain each person's numeric chat ID. On your own computer, open
   `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates` after they send `/start`.
   Identify each person from `result[].message.from`, then use that message's
   `message.chat.id`. Do not copy `update_id` or `message_id`. Phone numbers and
   personal `@usernames` cannot be substituted for private chat IDs. If the result is
   empty, send another message to the bot and refresh. Keep the token-bearing URL private.
4. Add these lines to your local `.env` (replace all placeholders):

   ```dotenv
   TELEGRAM_ENABLED=true
   TELEGRAM_BOT_TOKEN=your_bot_token_from_BotFather
   TELEGRAM_CHAT_IDS=123456789,987654321
   ```

   A single recipient also works. Duplicate IDs are removed. For compatibility,
   `TELEGRAM_CHAT_ID` is accepted when `TELEGRAM_CHAT_IDS` is empty. Negative group
   IDs are supported, provided the bot is a member and can send messages.
5. Restart Trade M2, then click **Send test to both chats** in the Telegram panel.
   It shows a separate result for each recipient. Upstox login and an open market
   are not needed for this test. `sent` means Telegram accepted the message, not
   that the person read it.

The token stays on the server, is excluded from Git via `.env`, and is not returned
to the dashboard. Set `TELEGRAM_ENABLED=false` and restart to turn delivery off.
Leave the computer awake, the program running, and Upstox connected for market alerts.
Updating `.env` always requires a restart.

Delivery uses SQLite queues and a separate background worker per recipient. A blocked
bot or wrong chat ID cannot prevent delivery to the other person. Acknowledged messages
are not resent after a restart; transient errors retry up to five attempts, and Telegram
rate-limit delays are respected. There is a rare possibility of duplicate delivery if
Telegram accepts a message but its response is lost or the process stops before saving
success. Messages carry an alert ID to identify that case.

First enablement skips already-stored alerts. Subsequently, pending deliveries survive
restarts, but signals more than **five minutes past their original event time** expire.
Recovered signals within that window are explicitly marked delayed. Queued alerts whose
rules were recalculated are cancelled when the old event is removed. Counters include
test messages. Separate program installations have separate queues and may both send
alerts if configured with the same bot and recipient IDs.

Telegram's standard bot messaging is free within its rate limits; this implementation
does not enable paid broadcasts. References: [Bot API](https://core.telegram.org/bots/api),
[limits](https://core.telegram.org/bots/faq#how-do-i-avoid-hitting-limits).

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
