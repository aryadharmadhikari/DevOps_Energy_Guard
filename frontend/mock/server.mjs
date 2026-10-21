// EnergyGuard mock backend (frontend use only).
//
// Behaves like Arya's real backend as described in CONTRACT.md (v1.0):
// same endpoints, same JSON shapes, same SSE events, same alert merge rule.
// It fills 30 days of history on start, then produces a live reading per
// meter every few seconds, with an occasional fault so alerts happen.
//
// Run:  npm run mock          (listens on http://localhost:8000)
// Demo: curl -X POST localhost:8000/mock/inject -H 'Content-Type: application/json' \
//            -d '{"meter_id":"M1","type":"high_load_spike","minutes":3}'

import express from "express";

const PORT = Number(process.env.MOCK_PORT ?? 8000);
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://localhost:4173")
  .split(",")
  .map((s) => s.trim());
const LIVE_INTERVAL_MS = Number(process.env.SIM_INTERVAL_SECONDS ?? 5) * 1000;
const ALERT_MERGE_MS = Number(process.env.ALERT_MERGE_MINUTES ?? 10) * 60_000;
const BACKFILL_DAYS = 30;

const APPLIANCES = ["ac", "fridge", "geyser", "washing_machine", "lighting", "fan", "tv", "other"];
const ANOMALY_TYPES = ["baseload_leakage", "high_load_spike", "voltage_fluctuation"];

// Each meter is a household (or hostel block) with its own size and limits.
const METERS = [
  { meter_id: "M1", name: "Home 1", scale: 1.0, spikeLimit: 3000, nightLimit: 450 },
  { meter_id: "M2", name: "Home 2", scale: 0.75, spikeLimit: 2400, nightLimit: 350 },
  { meter_id: "M3", name: "Home 3", scale: 1.7, spikeLimit: 5200, nightLimit: 800 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const iso = (ms) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
const istHour = (ms) => new Date(ms + 5.5 * 3600_000).getUTCHours();
const istWeekday = (ms) => new Date(ms + 5.5 * 3600_000).getUTCDay();
const chance = (p) => Math.random() < p;
const between = (a, b) => a + Math.random() * (b - a);

function apiError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

// ---------------------------------------------------------------------------
// Household load model: a believable Indian home day.
// Night is quiet, a geyser in the morning, AC in the afternoon and late night,
// lights + TV + fans in the evening.
// ---------------------------------------------------------------------------

// Appliances stay on or off for realistic stretches (an AC runs for tens of
// minutes, not 5 seconds). Each meter keeps its own appliance states.
const RULES = {
  // chance it turns on at this hour, how long it stays on/off (minutes), power when on (W)
  ac: { on: (h) => (h >= 13 && h < 17 ? 0.6 : h >= 22 || h < 1 ? 0.65 : 0.03), run: [20, 60], rest: [10, 40], watts: [1050, 1300] },
  fridge: { on: () => 0.6, run: [8, 15], rest: [6, 12], watts: [120, 160] },
  geyser: { on: (h) => (h >= 6 && h < 8 ? 0.35 : 0), run: [10, 20], rest: [30, 90], watts: [1800, 2000] },
  washing_machine: { on: (h, weekend) => (weekend && h >= 9 && h < 11 ? 0.4 : 0), run: [40, 55], rest: [120, 240], watts: [400, 550] },
  tv: { on: (h) => (h >= 19 && h < 23 ? 0.75 : h >= 12 && h < 15 ? 0.2 : 0), run: [30, 90], rest: [15, 60], watts: [90, 130] },
}

function normalAppliances(meter, ms) {
  const h = istHour(ms);
  const weekend = [0, 6].includes(istWeekday(ms));
  meter.state ??= {};
  const w = {};
  for (const [name, rule] of Object.entries(RULES)) {
    let st = meter.state[name];
    if (!st || ms >= st.until) {
      const on = chance(rule.on(h, weekend));
      const [lo, hi] = on ? rule.run : rule.rest;
      st = meter.state[name] = { on, until: ms + between(lo, hi) * 60_000, watts: between(...rule.watts) };
    }
    w[name] = st.on ? st.watts + between(-15, 15) : 0;
  }
  // Lights and fans follow the time of day; "other" is chargers, router, standby.
  w.lighting = h >= 18 && h < 24 ? between(80, 120) : h >= 6 && h < 8 ? between(30, 50) : 0;
  w.fan = h >= 12 || h < 6 ? between(110, 140) : between(20, 40);
  w.other = between(50, 75);
  const out = {};
  for (const k of APPLIANCES) out[k] = round1(Math.max(0, w[k]) * meter.scale);
  return out;
}

// An active fault changes the readings for a while, like a real problem would.
function applyFault(fault, appliances, voltage, scale) {
  if (!fault) return voltage;
  if (fault.type === "high_load_spike") appliances.other = round1(appliances.other + between(2200, 2800) * scale);
  if (fault.type === "baseload_leakage") appliances.other = round1(appliances.other + between(450, 650) * scale);
  if (fault.type === "voltage_fluctuation") return round1(chance(0.5) ? between(192, 204) : between(256, 264));
  return voltage;
}

function makeReading(meter, ms, fault) {
  const appliances_w = normalAppliances(meter, ms);
  let voltage_v = round1(between(226, 238));
  voltage_v = applyFault(fault, appliances_w, voltage_v, meter.scale);
  const total_power_w = round1(APPLIANCES.reduce((s, k) => s + appliances_w[k], 0));
  return {
    meter_id: meter.meter_id,
    timestamp: iso(ms),
    total_power_w,
    voltage_v,
    appliances_w,
    sim_label: fault ? fault.type : "normal",
  };
}

// ---------------------------------------------------------------------------
// Stand-in for Ameya's score_reading(): same output shape (contract 4.2).
// ---------------------------------------------------------------------------

function severityFor(score) {
  if (score < 0.5) return null;
  if (score < 0.6) return "low"; // 0.6 starts medium, as in the real backend
  if (score <= 0.8) return "medium";
  return "high";
}

function scoreReading(meter, reading) {
  const ms = Date.parse(reading.timestamp);
  const h = istHour(ms);
  const candidates = [];
  const { total_power_w: p, voltage_v: v } = reading;

  if (p > meter.spikeLimit) {
    candidates.push(["high_load_spike", Math.min(0.97, 0.62 + (p - meter.spikeLimit) / meter.spikeLimit)]);
  }
  // 2 to 5 AM: the home should be at its quietest.
  if (h >= 2 && h < 5 && p > meter.nightLimit) {
    candidates.push(["baseload_leakage", Math.min(0.9, 0.52 + (p - meter.nightLimit) / (meter.nightLimit * 3))]);
  }
  if (v !== null && (v < 207 || v > 253)) {
    const off = v < 207 ? 207 - v : v - 253;
    candidates.push(["voltage_fluctuation", Math.min(0.95, 0.55 + off / 25)]);
  }

  if (candidates.length === 0) {
    return { is_anomaly: false, anomaly_type: "none", score: round2(between(0.04, 0.3)), severity: null, model_version: "mock" };
  }
  candidates.sort((a, b) => b[1] - a[1]);
  const [anomaly_type, raw] = candidates[0];
  const score = round2(raw);
  return { is_anomaly: score >= 0.5, anomaly_type, score, severity: severityFor(score), model_version: "mock" };
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

let nextReadingId = 1;
let nextAlertId = 1;
const readings = new Map(METERS.map((m) => [m.meter_id, []])); // time-ordered per meter
const alerts = []; // newest last
const faults = new Map(); // meter_id -> { type, untilMs }
const streams = new Set(); // { res, meterId }

// Same wording as the real backend: "High load spike on M1: 1840.5 W".
const alertMessage = (type, r) => {
  const title = type.replaceAll("_", " ");
  return `${title[0].toUpperCase()}${title.slice(1)} on ${r.meter_id}: ${r.total_power_w} W`;
};

function broadcast(event, payload, meterId) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const s of streams) {
    if (!s.meterId || s.meterId === meterId) s.res.write(frame);
  }
}

// Contract 4.3 merge rule: one open alert per meter + type while the problem lasts.
function recordAnomaly(reading, anomaly, { backfill }) {
  const ms = Date.parse(reading.timestamp);
  const nowIso = backfill ? reading.timestamp : iso(Date.now());
  const open = alerts.findLast(
    (a) =>
      a.meter_id === reading.meter_id &&
      a.anomaly_type === anomaly.anomaly_type &&
      a.status === (backfill ? "acknowledged" : "open") &&
      (!backfill || a.note === "backfill") &&
      ms - Date.parse(a.last_seen_at) <= ALERT_MERGE_MS,
  );

  if (open) {
    open.last_seen_at = reading.timestamp;
    open.occurrence_count += 1;
    open.peak_power_w = Math.max(open.peak_power_w, reading.total_power_w);
    if (anomaly.score > open.score) {
      open.score = anomaly.score;
      open.severity = anomaly.severity;
    }
    open.updated_at = nowIso;
    if (!backfill) broadcast("alert", open, open.meter_id);
    return { created: false };
  }

  const alert = {
    alert_id: nextAlertId++,
    meter_id: reading.meter_id,
    reading_id: reading.reading_id,
    timestamp: reading.timestamp,
    last_seen_at: reading.timestamp,
    occurrence_count: 1,
    anomaly_type: anomaly.anomaly_type,
    severity: anomaly.severity,
    score: anomaly.score,
    total_power_w: reading.total_power_w,
    peak_power_w: reading.total_power_w,
    message: alertMessage(anomaly.anomaly_type, reading),
    status: backfill ? "acknowledged" : "open",
    note: backfill ? "backfill" : null,
    created_at: nowIso,
    updated_at: nowIso,
  };
  alerts.push(alert);
  if (!backfill) broadcast("alert", alert, alert.meter_id);
  return { created: true };
}

function saveReading(input, { backfill = false } = {}) {
  const meter = METERS.find((m) => m.meter_id === input.meter_id);
  const reading = { reading_id: nextReadingId++, ...input };
  readings.get(meter.meter_id).push(reading);
  const anomaly = scoreReading(meter, reading);
  let created = false;
  if (anomaly.is_anomaly) created = recordAnomaly(reading, anomaly, { backfill }).created;
  if (!backfill) broadcast("reading", { reading, anomaly }, reading.meter_id);
  return { reading, anomaly, created };
}

// ---------------------------------------------------------------------------
// Data generation: 30-day backfill at 1 reading/minute, then live.
// ---------------------------------------------------------------------------

function activeFault(meter, ms, perStepChance) {
  const f = faults.get(meter.meter_id);
  if (f && ms < f.untilMs) return f;
  faults.delete(meter.meter_id);
  if (!chance(perStepChance)) return null;
  const h = istHour(ms);
  const pool = h >= 2 && h < 5 ? ANOMALY_TYPES : ["high_load_spike", "voltage_fluctuation"];
  const type = pool[Math.floor(Math.random() * pool.length)];
  const fault = { type, untilMs: ms + between(2, 12) * 60_000 };
  faults.set(meter.meter_id, fault);
  return fault;
}

function backfill() {
  const end = Math.floor(Date.now() / 60_000) * 60_000;
  const start = end - BACKFILL_DAYS * 24 * 3600_000;
  for (let ms = start; ms < end; ms += 60_000) {
    for (const meter of METERS) {
      const fault = activeFault(meter, ms, 1 / 3200);
      saveReading(makeReading(meter, ms, fault), { backfill: true });
    }
  }
  faults.clear();
}

function tickLive() {
  const ms = Date.now();
  for (const meter of METERS) {
    const fault = activeFault(meter, ms, LIVE_INTERVAL_MS / (40 * 60_000)); // about one fault per 40 min per meter
    saveReading(makeReading(meter, ms, fault));
  }
}

// ---------------------------------------------------------------------------
// History buckets (contract 4.4)
// ---------------------------------------------------------------------------

const RANGES = {
  "24h": { size: 5 * 60_000, count: 288 },
  "7d": { size: 3600_000, count: 168 },
  "30d": { size: 24 * 3600_000, count: 30 },
};

function lowerBound(list, ms) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (Date.parse(list[mid].timestamp) < ms) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function history(meterId, range) {
  const { size, count } = RANGES[range];
  const lastStart = Math.floor(Date.now() / size) * size;
  const firstStart = lastStart - (count - 1) * size;
  const list = readings.get(meterId);
  const meterAlerts = alerts.filter((a) => a.meter_id === meterId);
  const buckets = [];
  let i = lowerBound(list, firstStart);

  for (let b = 0; b < count; b++) {
    const start = firstStart + b * size;
    const end = start + size;
    let n = 0;
    let sum = 0;
    let max = 0;
    const appSum = Object.fromEntries(APPLIANCES.map((k) => [k, 0]));
    while (i < list.length && Date.parse(list[i].timestamp) < end) {
      const r = list[i++];
      n += 1;
      sum += r.total_power_w;
      max = Math.max(max, r.total_power_w);
      for (const k of APPLIANCES) appSum[k] += r.appliances_w[k];
    }
    const alert_count = meterAlerts.filter((a) => {
      const t = Date.parse(a.timestamp);
      return t >= start && t < end;
    }).length;

    if (n === 0) {
      // The real backend sends null for every value of an empty bucket.
      buckets.push({
        bucket_start: iso(start),
        avg_power_w: null,
        max_power_w: null,
        energy_kwh: null,
        appliances_kwh: null,
        alert_count: null,
      });
      continue;
    }
    // Energy = average power x bucket length. For the current, unfinished
    // bucket only the time elapsed so far counts.
    const hours = (Math.min(end, Date.now()) - start) / 3600_000;
    buckets.push({
      bucket_start: iso(start),
      avg_power_w: round1(sum / n),
      max_power_w: round1(max),
      energy_kwh: round2(((sum / n) * hours) / 1000),
      appliances_kwh: Object.fromEntries(APPLIANCES.map((k) => [k, round2(((appSum[k] / n) * hours) / 1000)])),
      alert_count,
    });
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Input validation for POST /readings (contract 4.1)
// ---------------------------------------------------------------------------

function validReading(r) {
  if (!r || typeof r !== "object") return "Body must be a Reading object";
  if (!METERS.some((m) => m.meter_id === r.meter_id)) return `Unknown meter_id ${r.meter_id}`;
  if (typeof r.timestamp !== "string" || !r.timestamp.endsWith("Z") || Number.isNaN(Date.parse(r.timestamp)))
    return "timestamp must be UTC ISO 8601 ending in Z";
  if (typeof r.total_power_w !== "number") return "total_power_w must be a number";
  if (r.voltage_v !== null && typeof r.voltage_v !== "number") return "voltage_v must be a number or null";
  if (!r.appliances_w || APPLIANCES.some((k) => typeof r.appliances_w[k] !== "number"))
    return `appliances_w must contain numbers for: ${APPLIANCES.join(", ")}`;
  return null;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: "2mb" }));

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const api = express.Router();

api.get("/health", (_req, res) => res.json({ status: "ok" }));

api.get("/meters", (_req, res) => {
  res.json(
    METERS.map((m) => {
      const list = readings.get(m.meter_id);
      return { meter_id: m.meter_id, name: m.name, last_seen: list.at(-1)?.timestamp ?? null };
    }),
  );
});

function requireMeter(req, res) {
  const meterId = req.query.meter_id;
  if (!meterId) {
    apiError(res, 400, "meter_id_required", "Add ?meter_id=M1 to the request");
    return null;
  }
  if (!readings.has(meterId)) {
    apiError(res, 404, "meter_not_found", `No meter with id ${meterId}`);
    return null;
  }
  return meterId;
}

api.get("/readings/latest", (req, res) => {
  const meterId = requireMeter(req, res);
  if (!meterId) return;
  const last = readings.get(meterId).at(-1);
  if (!last) return apiError(res, 404, "no_readings", `No readings yet for ${meterId}`);
  res.json(last);
});

api.get("/readings/history", (req, res) => {
  const meterId = requireMeter(req, res);
  if (!meterId) return;
  const range = req.query.range;
  if (!RANGES[range]) return apiError(res, 400, "invalid_range", "range must be 24h, 7d or 30d");
  res.json({ meter_id: meterId, range, buckets: history(meterId, range) });
});

api.post("/readings", (req, res) => {
  const problem = validReading(req.body);
  if (problem) return apiError(res, 422, "invalid_reading", problem);
  const { reading_id: _ignored, ...input } = req.body;
  const { reading, anomaly } = saveReading(input);
  res.status(201).json({ reading, anomaly });
});

api.post("/readings/batch", (req, res) => {
  const list = req.body?.readings;
  if (!Array.isArray(list) || list.length === 0 || list.length > 500)
    return apiError(res, 422, "invalid_batch", "readings must be a list of 1 to 500 Readings");
  for (const r of list) {
    const problem = validReading(r);
    if (problem) return apiError(res, 422, "invalid_reading", problem);
  }
  const isBackfill = req.query.backfill === "true";
  let alerts_created = 0;
  for (const { reading_id: _ignored, ...input } of list) {
    if (saveReading(input, { backfill: isBackfill }).created) alerts_created += 1;
  }
  res.status(201).json({ saved: list.length, alerts_created });
});

const STATUSES = ["open", "acknowledged", "false_alarm"];

api.get("/alerts", (req, res) => {
  const { meter_id, status } = req.query;
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 500);
  if (status && !STATUSES.includes(status))
    return apiError(res, 400, "invalid_status", "status must be open, acknowledged or false_alarm");
  if (meter_id && !readings.has(meter_id)) return apiError(res, 404, "meter_not_found", `No meter with id ${meter_id}`);
  const list = alerts
    .filter((a) => (!meter_id || a.meter_id === meter_id) && (!status || a.status === status))
    .sort((a, b) => Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at))
    .slice(0, limit);
  res.json(list);
});

api.patch("/alerts/:id", (req, res) => {
  const alert = alerts.find((a) => a.alert_id === Number(req.params.id));
  if (!alert) return apiError(res, 404, "alert_not_found", `No alert with id ${req.params.id}`);
  const { status, note } = req.body ?? {};
  if (!["acknowledged", "false_alarm"].includes(status))
    return apiError(res, 400, "invalid_status", "status must be acknowledged or false_alarm");
  if (note !== undefined && note !== null && typeof note !== "string")
    return apiError(res, 400, "bad_note", "note must be text");
  alert.status = status;
  if (note !== undefined) alert.note = note;
  alert.updated_at = iso(Date.now());
  broadcast("alert", alert, alert.meter_id);
  res.json(alert);
});

api.get("/stream", (req, res) => {
  const meterId = req.query.meter_id;
  if (meterId && !readings.has(meterId)) return apiError(res, 404, "meter_not_found", `No meter with id ${meterId}`);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");
  const client = { res, meterId };
  streams.add(client);
  req.on("close", () => streams.delete(client));
});

app.use("/api/v1", api);

// Mock-only helper (not part of the contract): force a fault for demos.
app.post("/mock/inject", (req, res) => {
  const { meter_id = "M1", type = "high_load_spike", minutes = 3 } = req.body ?? {};
  if (!readings.has(meter_id)) return apiError(res, 404, "meter_not_found", `No meter with id ${meter_id}`);
  if (!ANOMALY_TYPES.includes(type)) return apiError(res, 400, "bad_type", `type must be one of ${ANOMALY_TYPES.join(", ")}`);
  faults.set(meter_id, { type, untilMs: Date.now() + Number(minutes) * 60_000 });
  res.json({ injected: { meter_id, type, minutes } });
});

app.use((_req, res) => apiError(res, 404, "not_found", "No such endpoint"));

// Heartbeat keeps proxies and browsers from closing idle streams.
setInterval(() => {
  for (const s of streams) s.res.write(": heartbeat\n\n");
}, 15_000);

const t0 = Date.now();
backfill();
const count = METERS.length * BACKFILL_DAYS * 1440;
console.log(`Backfilled ${count.toLocaleString("en-IN")} readings and ${alerts.length} past alerts in ${Date.now() - t0} ms`);

setInterval(tickLive, LIVE_INTERVAL_MS);
tickLive();

app.listen(PORT, () => {
  console.log(`EnergyGuard mock backend on http://localhost:${PORT}/api/v1`);
  console.log(`Live readings every ${LIVE_INTERVAL_MS / 1000}s for ${METERS.map((m) => m.meter_id).join(", ")}`);
});
