// Единая серверная функция учебных сессий (/api/study/*).
// Одна функция вместо десяти: у тарифа Hobby лимит 12 функций на деплой.
import { randomUUID } from "node:crypto";
import { getStore } from "./_lib/db.js";
import { hashPin, verifyPin, signToken, verifyToken, isAdmin, generatePin } from "./_lib/auth.js";
import { CASES } from "./_lib/cases.generated.js";
import { PLAN, MODE_OF_KIND, todayAlmaty } from "./_lib/plan.js";
import { PROMPT_VERSION, DEBRIEF_PROMPT, buildSystemPrompt, callModel, parseHints, toApiMessages } from "./_lib/tutor.js";

const MAX_TEXT = 4000;
// Явные команды завершения кейса, набранные текстом (кнопка «Завершить кейс» делает то же самое)
const FINISH_RE = /^(конец кейса|завершить кейс|закончить кейс|завершить[, ]+дай разбор|дай разбор)[.!\s]*$/i;
const MAX_TURNS = 60;
const LOCK_AFTER = 5;
const LOCK_MINUTES = 10;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};

// После rewrite Vercel кладёт параметры в req.query; в локальном сервере они тоже есть. URL — запасной путь.
function param(req, name) {
  const v = req.query?.[name];
  if (v != null) return Array.isArray(v) ? v[0] : String(v);
  return new URL(req.url, "http://x").searchParams.get(name);
}

function routeOf(req) {
  const q = req.query?.route;
  if (q) return Array.isArray(q) ? q.join("/") : String(q);
  const path = new URL(req.url, "http://x").pathname;
  return path.replace(/^\/api\/study\/?/, "");
}

async function authResident(req, store) {
  const h = String(req.headers.authorization || "");
  const payload = verifyToken(h.startsWith("Bearer ") ? h.slice(7) : "");
  if (!payload) fail(401, "Требуется вход");
  const resident = await store.getResident(payload.rid);
  if (!resident) fail(401, "Требуется вход");
  return resident;
}

function residentView(r) {
  return { id: r.id, pgy: r.pgy, consent: !!r.consent_at };
}

function attemptView(a) {
  const kase = CASES[a.case_id];
  return {
    id: a.id,
    case_id: a.case_id,
    title: kase?.title || a.case_id,
    mode: a.mode,
    status: a.status,
    // служебные метки подсказок резиденту не показываем
    transcript: a.transcript.map(({ role, content, ts, kind }) => ({ role, content, ts, kind })),
  };
}

function visiblePlan(resident) {
  const today = todayAlmaty();
  const isTester = resident.id.startsWith("T");
  return PLAN.filter((p) => isTester || p.date <= today);
}

async function homeItems(resident, store) {
  const items = [];
  for (const entry of visiblePlan(resident)) {
    for (const it of entry.items) {
      const kase = CASES[it.case];
      if (!kase) continue;
      const mode = MODE_OF_KIND[it.kind];
      const attempt = await store.findAttempt(resident.id, it.case, mode);
      let locked = false;
      if (mode === "retest") {
        const first = await store.findAttempt(resident.id, it.case, "tutored");
        locked = !first || first.status === "draft";
      }
      items.push({
        date: entry.date,
        case_id: it.case,
        title: kase.title,
        kind: it.kind,
        mode,
        status: attempt ? attempt.status : "new",
        attempt_id: attempt ? attempt.id : null,
        locked,
      });
    }
  }
  return items;
}

async function ownAttempt(store, resident, id) {
  const a = id ? await store.getAttempt(String(id)) : null;
  if (!a || a.resident_id !== resident.id) fail(404, "Попытка не найдена");
  return a;
}

function csvCell(v) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const routes = {
  // ─── Резидент ──────────────────────────────────────────────────────────
  async "POST login"(req, store) {
    const id = String(req.body?.id || "").trim().toUpperCase();
    const pin = String(req.body?.pin || "").trim();
    const bad = () => fail(401, "Неверный ID или PIN");
    if (!id || !pin) bad();
    const r = await store.getResident(id);
    if (!r) bad();
    if (r.locked_until && new Date(r.locked_until) > new Date()) {
      fail(429, `Слишком много попыток. Повторите позже (около ${LOCK_MINUTES} мин)`);
    }
    if (!verifyPin(pin, r.pin_hash)) {
      const n = (r.fail_count || 0) + 1;
      await store.setFail(id, n >= LOCK_AFTER ? 0 : n, n >= LOCK_AFTER ? new Date(Date.now() + LOCK_MINUTES * 60000) : null);
      bad();
    }
    if (r.fail_count) await store.setFail(id, 0, null);
    return { token: signToken({ rid: id }), resident: residentView(r) };
  },

  async "GET home"(req, store) {
    const r = await authResident(req, store);
    return { resident: residentView(r), items: await homeItems(r, store) };
  },

  async "POST consent"(req, store) {
    const r = await authResident(req, store);
    await store.setConsent(r.id);
    return { ok: true };
  },

  async "POST start"(req, store) {
    const r = await authResident(req, store);
    if (!r.consent_at) fail(403, "Сначала подтвердите согласие");
    const caseId = String(req.body?.case_id || "");
    const mode = String(req.body?.mode || "");
    const item = (await homeItems(r, store)).find((i) => i.case_id === caseId && i.mode === mode);
    if (!item) fail(404, "Этот кейс сейчас недоступен");
    if (item.locked) fail(409, "Сначала пройдите кейс в первый раз");
    const kase = CASES[caseId];
    let a = await store.findAttempt(r.id, caseId, mode);
    if (!a) {
      await store.createAttempt({
        id: randomUUID(),
        resident_id: r.id,
        case_id: caseId,
        case_version: kase.version,
        case_hash: kase.hash,
        mode,
        transcript: [{ role: "assistant", content: kase.opening, ts: new Date().toISOString(), kind: "opening" }],
      });
      a = await store.findAttempt(r.id, caseId, mode);
    }
    return { attempt: attemptView(a) };
  },

  async "GET attempt"(req, store) {
    const r = await authResident(req, store);
    return { attempt: attemptView(await ownAttempt(store, r, param(req, "id"))) };
  },

  async "POST chat"(req, store) {
    const r = await authResident(req, store);
    const a = await ownAttempt(store, r, req.body?.attempt_id);
    if (a.status !== "draft") fail(409, "Кейс уже завершён");
    const text = String(req.body?.text || "").trim();
    if (!text) fail(400, "Пустое сообщение");
    if (text.length > MAX_TEXT) fail(400, `Сообщение длиннее ${MAX_TEXT} символов`);
    const expectedLen = Number(req.body?.expected_len);
    if (expectedLen !== a.transcript.length) fail(409, "Переписка изменилась, обновите страницу");
    if (a.transcript.filter((m) => m.role === "user").length >= MAX_TURNS) fail(429, "Достигнут лимит реплик. Завершите кейс");
    if (FINISH_RE.test(text)) return routes["POST finish"](req, store);

    const kase = CASES[a.case_id];
    const userMsg = { role: "user", content: text, ts: new Date().toISOString() };
    const out = await callModel({
      system: buildSystemPrompt(kase, a.mode),
      messages: toApiMessages([...a.transcript, userMsg]),
    });
    const { clean, hints } = parseHints(out.text);
    const reply = { role: "assistant", content: clean, ts: new Date().toISOString(), model: out.model, prompt_version: PROMPT_VERSION, usage: out.usage, stop_reason: out.stop_reason };
    if (out.stop_reason === "max_tokens") reply.truncated = true;
    if (hints.length && a.mode === "tutored") reply.hints = hints;
    const n = await store.appendTurn(a.id, expectedLen, [userMsg, reply], out.model);
    if (n == null) fail(409, "Переписка изменилась, обновите страницу");
    return { reply: clean, length: n };
  },

  async "POST finish"(req, store) {
    const r = await authResident(req, store);
    const a = await ownAttempt(store, r, req.body?.attempt_id);
    if (a.status !== "draft") return { attempt: attemptView(a) };
    const kase = CASES[a.case_id];
    const marker = { role: "user", content: "[Кейс завершён резидентом]", ts: new Date().toISOString(), kind: "finish" };
    const out = await callModel({
      system: buildSystemPrompt(kase, a.mode),
      messages: [...toApiMessages(a.transcript, { annotateHints: true }), { role: "user", content: DEBRIEF_PROMPT }],
      maxTokens: 2000,
    });
    const debrief = { role: "assistant", content: parseHints(out.text).clean, ts: new Date().toISOString(), kind: "debrief", model: out.model, prompt_version: PROMPT_VERSION, usage: out.usage, stop_reason: out.stop_reason };
    if (out.stop_reason === "max_tokens") debrief.truncated = true;
    const n = await store.appendTurn(a.id, a.transcript.length, [marker, debrief], out.model);
    if (n == null) fail(409, "Переписка изменилась, обновите страницу");
    await store.setStatus(a.id, "finished");
    return { attempt: attemptView(await store.getAttempt(a.id)) };
  },

  async "POST submit"(req, store) {
    const r = await authResident(req, store);
    const a = await ownAttempt(store, r, req.body?.attempt_id);
    if (a.status === "draft") fail(409, "Сначала завершите кейс");
    if (a.status === "finished") await store.setStatus(a.id, "submitted");
    return { attempt: attemptView(await store.getAttempt(a.id)) };
  },

  // ─── Администратор (заголовок x-admin-token) ────────────────────────────
  async "POST admin/setup"() {
    return { ok: true };
  },

  async "POST admin/residents"(req, store) {
    const list = Array.isArray(req.body?.residents) ? req.body.residents : [];
    if (!list.length) fail(400, "Передайте residents: [{id, pgy}]");
    const out = [];
    for (const item of list) {
      const id = String(item.id || "").trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9]{1,5}$/.test(id)) fail(400, `Некорректный ID: ${id}`);
      const pin = item.pin ? String(item.pin) : generatePin();
      await store.saveResident({ id, pgy: item.pgy == null ? null : Number(item.pgy), pin_hash: hashPin(pin) });
      out.push({ id, pgy: item.pgy ?? null, pin });
    }
    return { residents: out, note: "PIN показан один раз. Передайте каждому лично." };
  },

  async "GET admin/overview"(req, store) {
    const residents = await store.listResidents();
    const attempts = await store.listAttempts();
    return {
      residents,
      attempts: attempts.map((a) => ({
        id: a.id, resident_id: a.resident_id, case_id: a.case_id, case_version: a.case_version, mode: a.mode,
        status: a.status, messages: a.transcript.length, started_at: a.started_at, submitted_at: a.submitted_at,
      })),
      cases: Object.values(CASES).map((c) => ({ id: c.id, version: c.version, hash: c.hash })),
      backend: store.kind,
    };
  },

  async "GET admin/export"(req, store) {
    const fmt = param(req, "format") || "json";
    const residents = Object.fromEntries((await store.listResidents()).map((r) => [r.id, r]));
    const attempts = await store.listAttempts();
    if (fmt === "csv") {
      const head = ["resident_id", "pgy", "case_id", "case_version", "case_hash", "mode", "status", "model", "attempt_id", "seq", "role", "kind", "ts", "hints", "content"];
      const rows = [head.join(",")];
      for (const a of attempts) {
        a.transcript.forEach((m, i) => {
          rows.push([
            a.resident_id, residents[a.resident_id]?.pgy, a.case_id, a.case_version, a.case_hash, a.mode, a.status,
            m.model || a.model, a.id, i + 1, m.role, m.kind || "", m.ts, m.hints ? JSON.stringify(m.hints) : "", m.content,
          ].map(csvCell).join(","));
        });
      }
      return { __raw: "﻿" + rows.join("\n"), contentType: "text/csv; charset=utf-8" };
    }
    return {
      exported_at: new Date().toISOString(),
      attempts: attempts.map((a) => ({ ...a, pgy: residents[a.resident_id]?.pgy ?? null })),
    };
  },

  async "POST admin/reset"(req, store) {
    const id = String(req.body?.attempt_id || "");
    if (!(await store.getAttempt(id))) fail(404, "Попытка не найдена");
    await store.deleteAttempt(id);
    return { ok: true };
  },
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const route = routeOf(req).replace(/\/+$/, "");
    const fn = routes[`${req.method} ${route}`];
    if (!fn) {
      const known = Object.keys(routes).some((k) => k.endsWith(` ${route}`));
      return res.status(known ? 405 : 404).json({ error: known ? "Метод не поддерживается" : "Неизвестный маршрут" });
    }
    if (route.startsWith("admin/") && !isAdmin(req)) return res.status(401).json({ error: "Нет доступа" });
    if (route === "admin/setup") {
      await getStore();
      return res.json({ ok: true });
    }
    const store = await getStore();
    const out = await fn(req, store);
    if (out && out.__raw !== undefined) {
      res.setHeader("Content-Type", out.contentType);
      return res.status(200).send(out.__raw);
    }
    return res.status(200).json(out);
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error("study api error:", err?.message);
    return res.status(500).json({ error: "Внутренняя ошибка сервера" });
  }
}
