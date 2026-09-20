const state = { rules: [], events: [], latestId: 0, source: null, jobTimer: null };
const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[char]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail || `Request failed (${response.status})`);
  return body;
}

function showMessage(text, error = false) {
  const element = $("message");
  element.textContent = text;
  element.classList.toggle("error", error);
  element.classList.remove("hidden");
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => element.classList.add("hidden"), 9000);
}

function showQueryMessage() {
  const query = new URLSearchParams(location.search);
  if (query.has("error")) showMessage(query.get("error"), true);
  if (query.has("login")) showMessage("Upstox connected. Live monitoring is ready.");
  if (query.size) history.replaceState({}, "", location.pathname);
}

async function refreshStatus() {
  try {
    const data = await api("/api/status");
    $("authStatus").textContent = data.authenticated ? "Connected" : (data.configured ? "Login needed" : "Not configured");
    $("userName").textContent = data.authenticated ? data.user_name : "OAuth required daily";
    $("loginButton").textContent = data.authenticated ? "Reconnect Upstox" : "Connect Upstox";
    const feed = data.monitor;
    $("feedStatus").textContent = feed.stale ? "Stale" : (feed.connected ? "Streaming" : (feed.running ? "Reconnecting" : "Stopped"));
    $("feedDetail").textContent = `${feed.active_subscriptions} live · ${feed.recovering_subscriptions} recovering`;
    $("ruleCount").textContent = `${data.rule_count} / 200`;
    $("activeCount").textContent = `${data.active_rule_count} active · ${data.market_open ? "market open" : "market closed"}`;
    if (feed.last_error) $("feedDetail").title = feed.last_error;
    if (data.load_job?.status === "RUNNING" && !state.jobTimer) watchJob(data.load_job.id);
    if (data.authenticated) refreshMovement();
  } catch (error) {
    $("feedStatus").textContent = "Unavailable";
  }
}

async function refreshMovement() {
  try {
    const data = await api("/api/market-movement");
    $("movementValue").textContent = `${data.moving_percentage_display}`;
    $("movementDetail").textContent = `VIX ${data.vix_close} · ${data.reference_date}`;
    if (!$("percentage").value) $("percentage").placeholder = data.moving_percentage;
  } catch (_) { /* Status already explains authentication. */ }
}

function renderRules() {
  const filter = $("filter").value.trim().toUpperCase();
  const rules = state.rules.filter((rule) => !filter || rule.tradingsymbol.includes(filter));
  if (!rules.length) {
    $("rulesBody").innerHTML = `<tr><td colspan="7" class="empty-state">${state.rules.length ? "No matching stocks." : "Load the Nifty 200 to begin."}</td></tr>`;
    return;
  }
  $("rulesBody").innerHTML = rules.map((rule) => {
    const zone = rule.opening_zone ? escapeHtml(rule.opening_zone.replace("ON_", "AT ")) : "waiting";
    return `<tr>
      <td><span class="symbol">${escapeHtml(rule.tradingsymbol)}</span></td>
      <td>₹${escapeHtml(rule.reference_close_display)}<br><small>${escapeHtml(rule.reference_date)}</small></td>
      <td>${rule.opening_price ? `₹${escapeHtml(rule.opening_price)}` : "—"}<br><small>${zone}</small></td>
      <td class="upper">₹${escapeHtml(rule.upper_level_display)}${rule.upper_sent ? '<span class="sent">✓ sent</span>' : ""}</td>
      <td class="lower">₹${escapeHtml(rule.lower_level_display)}${rule.lower_sent ? '<span class="sent">✓ sent</span>' : ""}</td>
      <td><span class="zone ${rule.active ? "active" : ""}">${rule.active ? "active" : "paused"}</span></td>
      <td><button class="button small secondary rule-toggle" data-id="${rule.id}" data-active="${!rule.active}">${rule.active ? "Pause" : "Start"}</button></td>
    </tr>`;
  }).join("");
}

async function refreshRules() {
  try {
    state.rules = await api("/api/rules");
    renderRules();
  } catch (error) { showMessage(error.message, true); }
}

function eventMarkup(event) {
  const when = new Date(event.event_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const sideClass = event.trade_side === "SHORT" ? "short" : "";
  return `<article class="alert-row ${sideClass}">
    <span class="alert-side">${escapeHtml(event.trade_side)}</span>
    <span><span class="alert-symbol">${escapeHtml(event.tradingsymbol)}</span><br><span class="alert-meta">${escapeHtml(event.boundary)} · open ${escapeHtml(event.opening_zone)}</span></span>
    <span class="alert-price">Entry ₹${escapeHtml(event.entry_price_display)}</span>
    <span class="alert-price">SL ₹${escapeHtml(event.stop_loss_display)} (${escapeHtml(event.risk_percent_display)})</span>
    <span class="alert-meta">${when} · ${escapeHtml(event.source)}</span>
  </article>`;
}

function renderEvents() {
  $("alertCount").textContent = `${state.events.length} alert${state.events.length === 1 ? "" : "s"}`;
  $("alerts").innerHTML = state.events.length
    ? [...state.events].reverse().map(eventMarkup).join("")
    : '<div class="empty-state">No Case 2 crossings yet.</div>';
}

function notifyEvent(event) {
  if (Notification.permission !== "granted") return;
  const title = `${event.trade_side} ${event.tradingsymbol} · ${event.boundary}`;
  const body = `Entry ₹${event.entry_price_display} · SL ₹${event.stop_loss_display} (${event.risk_percent_display})`;
  const notification = new Notification(title, { body, tag: `trade-m2-${event.id}`, requireInteraction: true });
  notification.onclick = () => { window.focus(); notification.close(); };
}

function acceptEvent(event, notify = true) {
  const id = Number(event.id);
  if (state.events.some((existing) => Number(existing.id) === id)) return;
  state.events.push(event);
  state.events = state.events.slice(-500);
  state.latestId = Math.max(state.latestId, id);
  renderEvents();
  if (notify) notifyEvent(event);
  refreshRules();
}

async function startEvents() {
  try {
    const snapshot = await api("/api/events/snapshot");
    state.events = snapshot.events;
    state.latestId = snapshot.latest_id;
    renderEvents();
  } catch (error) { showMessage(error.message, true); }
  connectEventSource();
}

function connectEventSource() {
  state.source?.close();
  const source = new EventSource(`/api/events/stream?after_id=${state.latestId}`);
  state.source = source;
  source.addEventListener("alert", (message) => acceptEvent(JSON.parse(message.data), true));
  source.onerror = async () => {
    try {
      const missed = await api(`/api/events?after_id=${state.latestId}&limit=500`);
      missed.forEach((event) => acceptEvent(event, true));
    } catch (_) { /* EventSource retries on its own. */ }
  };
}

async function loadNifty200() {
  const button = $("loadButton");
  const value = $("percentage").value.trim();
  button.disabled = true;
  try {
    const body = value ? { percentage: value } : { percentage: null };
    const job = await api("/api/nifty200/load", { method: "POST", body: JSON.stringify(body) });
    $("jobArea").classList.remove("hidden");
    watchJob(job.id);
  } catch (error) {
    showMessage(error.message, true);
    button.disabled = false;
  }
}

function watchJob(id) {
  window.clearInterval(state.jobTimer);
  const update = async () => {
    try {
      const job = await api(`/api/jobs/${id}`);
      const total = job.total || 200;
      const percent = Math.round((job.processed / total) * 100);
      $("jobArea").classList.remove("hidden");
      $("progressBar").style.width = `${percent}%`;
      $("jobText").textContent = job.status === "RUNNING"
        ? `${job.processed}/${total} processed · ${job.created} ready · ${job.failed} failed · ${job.current_symbol || "starting"}`
        : `${job.status}: ${job.created} ready, ${job.failed} failed. Source: ${job.source || "—"}`;
      if (job.status !== "RUNNING") {
        window.clearInterval(state.jobTimer);
        state.jobTimer = null;
        $("loadButton").disabled = false;
        await Promise.all([refreshStatus(), refreshRules()]);
        if (job.status === "FAILED") showMessage(job.fatal_error || "Nifty 200 load failed.", true);
        else if (job.failed) showMessage(`${job.failed} symbols failed. Check the job API for details.`, true);
      }
    } catch (error) {
      window.clearInterval(state.jobTimer);
      state.jobTimer = null;
      $("loadButton").disabled = false;
      showMessage(error.message, true);
    }
  };
  update();
  state.jobTimer = window.setInterval(update, 1200);
}

async function setBulk(active) {
  try {
    await api("/api/rules/bulk-status", { method: "POST", body: JSON.stringify({ active }) });
    await Promise.all([refreshStatus(), refreshRules()]);
  } catch (error) { showMessage(error.message, true); }
}

$("notifyButton").addEventListener("click", async () => {
  if (!("Notification" in window)) return showMessage("This browser does not support desktop notifications.", true);
  const permission = await Notification.requestPermission();
  $("notifyButton").textContent = permission === "granted" ? "Browser alerts enabled" : "Enable browser alerts";
  if (permission !== "granted") showMessage("Browser notifications were not enabled.", true);
});
$("loadButton").addEventListener("click", loadNifty200);
$("filter").addEventListener("input", renderRules);
$("startAll").addEventListener("click", () => setBulk(true));
$("pauseAll").addEventListener("click", () => setBulk(false));
$("rulesBody").addEventListener("click", async (event) => {
  const button = event.target.closest(".rule-toggle");
  if (!button) return;
  button.disabled = true;
  try {
    await api(`/api/rules/${button.dataset.id}`, {
      method: "PATCH", body: JSON.stringify({ active: button.dataset.active === "true" })
    });
    await refreshRules();
  } catch (error) { showMessage(error.message, true); button.disabled = false; }
});

showQueryMessage();
refreshStatus();
refreshRules();
startEvents();
window.setInterval(refreshStatus, 5000);
window.setInterval(refreshRules, 8000);
if ("Notification" in window && Notification.permission === "granted") $("notifyButton").textContent = "Browser alerts enabled";
