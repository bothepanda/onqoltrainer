// Единая серверная функция учебных сессий (/api/study/*).
// Одна функция вместо десяти: у тарифа Hobby лимит 12 функций на деплой.
import { randomUUID } from "node:crypto";
import { getStore } from "./_lib/db.js";
import { hashPin, verifyPin, signToken, verifyToken, isAdmin, generatePin } from "./_lib/auth.js";
import { CASES } from "./_lib/cases.generated.js";
import { PLAN, MODE_OF_KIND, todayAlmaty } from "./_lib/plan.js";
import { PROMPT_VERSION, DEBRIEF_PROMPT, buildSystemPrompt, callModel, parseHints, toApiMessages, debriefFromGradingPrompt, hasEvalWords, REWRITE_NOTE, debriefFailed, isFinishText } from "./_lib/tutor.js";
import { runGrader, finalizeGrading, compareGradings, gradingForDebrief, metricsOf, GRADER_VERSION } from "./_lib/grader.js";

const MAX_TEXT = 4000;
// Автоматическая оценка при завершении кейса включается только STUDY_GRADING=auto.
// По умолчанию выключена: оценки загружаются из выгрузки (admin/grade-import) после занятия.
const gradingMode = () => (process.env.STUDY_GRADING === "auto" ? "auto" : "off");
// Бюджет времени функции на Vercel (60 с): повторные запросы к модели делаются, только если осталось время
const BUDGET_MS = 55000;
// Суммируем числовые поля usage двух запросов (для стоимости в аудите)
const sumUsage = (a = {}, b = {}) => {
  const s = { ...b };
  for (const k of Object.keys(a)) if (typeof a[k] === "number") s[k] = a[k] + (typeof b[k] === "number" ? b[k] : 0);
  return s;
};
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

async function gradingsByAttempt(store) {
  const map = {};
  for (const g of await store.listGradings()) (map[g.attempt_id] ||= {})[g.kind] = g;
  return map;
}
// Проверенная человеком оценка важнее оценки модели
const effectiveOf = (gs) => (gs?.human ? { kind: "human", result: gs.human.result } : gs?.model ? { kind: "model", result: gs.model.result } : null);

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
    // Текстовая команда завершить кейс (кнопка «Завершить кейс» делает то же самое)
    if (isFinishText(text)) return routes["POST finish"](req, store);

    const kase = CASES[a.case_id];
    const userMsg = { role: "user", content: text, ts: new Date().toISOString() };
    const t0 = Date.now();
    const system = buildSystemPrompt(kase, a.mode);
    const messages = toApiMessages([...a.transcript, userMsg]);
    let out = await callModel({ system, messages, cacheConversation: true, residentId: r.id });
    let regen = false;
    // Оценочные слова запрещены промптом, но модели иногда их пишут. Один повтор с пометкой, если хватает времени.
    if (hasEvalWords(out.text) && Date.now() - t0 < 15000) {
      try {
        const retry = await callModel({
          system,
          messages: [...messages, { role: "assistant", content: out.text }, { role: "user", content: REWRITE_NOTE }],
          timeoutMs: 20000,
          retries: 0,
          residentId: r.id,
        });
        if (retry.text && !hasEvalWords(retry.text)) {
          out = { ...retry, usage: sumUsage(out.usage, retry.usage) };
          regen = true;
        }
      } catch (err) {
        console.error("rewrite failed:", err?.message);
      }
    }
    const { clean, hints } = parseHints(out.text);
    const reply = { role: "assistant", content: clean, ts: new Date().toISOString(), model: out.model, prompt_version: PROMPT_VERSION, usage: out.usage, stop_reason: out.stop_reason };
    if (regen) reply.regen = "eval_words";
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

    // 1) независимая оценка по рубрике; при сбое разбор строится по старой схеме
    let grading = null;
    if (gradingMode() === "auto") {
      try {
        const g = await runGrader(kase, a.mode, a.transcript, { timeoutMs: 30000 });
        await store.saveGrading(a.id, "model", g.result, g.model, GRADER_VERSION);
        grading = g.result;
      } catch (err) {
        console.error("grader failed:", err?.message);
      }
    }

    // 2) разбор для резидента на основе оценки (или свободный, если оценка не получилась)
    const debriefPrompt = grading ? debriefFromGradingPrompt(gradingForDebrief(kase, grading, a.mode)) : DEBRIEF_PROMPT;
    const system = buildSystemPrompt(kase, a.mode);
    // Служебные реплики «нажмите кнопку» в переписке модель копирует вместо разбора: из запроса разбора их убираем
    const history = toApiMessages(a.transcript, { annotateHints: true }).filter((m) => !(m.role === "assistant" && m.content.length < 200 && /нажмите кнопку/i.test(m.content)));
    const ask = (timeoutMs) => callModel({ system, messages: [...history, { role: "user", content: debriefPrompt }], maxTokens: 2000, timeoutMs, retries: 0, residentId: r.id });
    const t0 = Date.now();
    let out = await ask(25000);
    // Разбор не получился (повтор фразы про кнопку или пустой ответ): один повтор, если хватает времени
    if (debriefFailed(out.text) && Date.now() - t0 < 25000 && BUDGET_MS - (Date.now() - t0) > 10000) {
      try {
        out = await ask(BUDGET_MS - (Date.now() - t0));
      } catch (err) {
        console.error("debrief retry failed:", err?.message);
      }
    }
    const debrief = { role: "assistant", content: parseHints(out.text).clean, ts: new Date().toISOString(), kind: "debrief", model: out.model, prompt_version: PROMPT_VERSION, usage: out.usage, stop_reason: out.stop_reason, graded: !!grading };
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
    const gr = await gradingsByAttempt(store);
    return {
      residents,
      attempts: attempts.map((a) => ({
        id: a.id, resident_id: a.resident_id, case_id: a.case_id, case_version: a.case_version, mode: a.mode,
        status: a.status, messages: a.transcript.length, started_at: a.started_at, submitted_at: a.submitted_at,
        graded: { model: !!gr[a.id]?.model, human: !!gr[a.id]?.human },
      })),
      cases: Object.values(CASES).map((c) => ({ id: c.id, version: c.version, hash: c.hash })),
      backend: store.kind,
      settings: { grading: gradingMode() },
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
    const gr = await gradingsByAttempt(store);
    return {
      exported_at: new Date().toISOString(),
      attempts: attempts.map((a) => ({
        ...a,
        pgy: residents[a.resident_id]?.pgy ?? null,
        grading: { model: gr[a.id]?.model?.result || null, human: gr[a.id]?.human?.result || null },
      })),
    };
  },

  async "POST admin/grade"(req, store) {
    const a = await store.getAttempt(String(req.body?.attempt_id || ""));
    if (!a) fail(404, "Попытка не найдена");
    if (a.status === "draft") fail(409, "Попытка ещё не завершена");
    const g = await runGrader(CASES[a.case_id], a.mode, a.transcript);
    await store.saveGrading(a.id, "model", g.result, g.model, GRADER_VERSION);
    return { grading: g.result };
  },

  // Загрузка оценок, сделанных вне сервера (например, в сессии Claude Code по выгрузке).
  // Приходят «сырые» баллы и цитаты; проверки кодом (цитата есть в реплике резидента, понижение по метке подсказки,
  // в повторе нет балла 1) применяются здесь заново, независимо от того, кто оценивал.
  async "POST admin/grade-import"(req, store) {
    const results = Array.isArray(req.body?.results) ? req.body.results : [];
    if (!results.length) fail(400, "Передайте results: [{attempt_id, raw}]");
    const label = String(req.body?.grader || "external").slice(0, 80);
    const saved = [];
    for (const r of results) {
      const a = await store.getAttempt(String(r.attempt_id || ""));
      if (!a) fail(404, `Попытка не найдена: ${r.attempt_id}`);
      if (a.status === "draft") fail(409, `Попытка ещё не завершена: ${r.attempt_id}`);
      const result = finalizeGrading(CASES[a.case_id], a.mode, a.transcript, r.raw);
      result.version = `${GRADER_VERSION}-external`;
      await store.saveGrading(a.id, "model", result, label, result.version);
      saved.push({ attempt_id: a.id, resident_id: a.resident_id, mode: a.mode, independence: result.metrics.independence, weighted: result.metrics.weighted });
    }
    return { saved };
  },

  async "GET admin/grading"(req, store) {
    const a = await store.getAttempt(String(param(req, "attempt_id") || ""));
    if (!a) fail(404, "Попытка не найдена");
    const gs = (await gradingsByAttempt(store))[a.id] || {};
    return {
      attempt: { id: a.id, resident_id: a.resident_id, case_id: a.case_id, case_version: a.case_version, mode: a.mode, status: a.status },
      rubric: CASES[a.case_id].rubric,
      transcript: a.transcript,
      model: gs.model?.result || null,
      human: gs.human?.result || null,
    };
  },

  // Ручная проверка: вы правите баллы модели. Проверенная оценка используется в сравнении вместо оценки модели.
  async "POST admin/grade-review"(req, store) {
    const a = await store.getAttempt(String(req.body?.attempt_id || ""));
    if (!a) fail(404, "Попытка не найдена");
    const kase = CASES[a.case_id];
    const given = Array.isArray(req.body?.items) ? req.body.items : [];
    const base = (await gradingsByAttempt(store))[a.id]?.model?.result;
    const items = kase.rubric.map((r) => {
      const g = given.find((x) => Number(x.n) === r.n);
      const prev = base?.items.find((i) => i.n === r.n) || {};
      const score = g && [0, 1, 2].includes(Number(g.score)) ? Number(g.score) : prev.score ?? 0;
      if (a.mode === "retest" && score === 1) fail(400, `Пункт ${r.n}: в повторе возможны только 0 и 2`);
      return { n: r.n, weight: r.weight, score, hint_level: Number(g?.hint_level ?? prev.hint_level) || 0, evidence: prev.evidence || "", evidence_msg: prev.evidence_msg ?? null, reason: String(g?.reason ?? prev.reason ?? ""), flags: [] };
    });
    const f = req.body?.flags || {};
    const flags = { c1: { value: f.c1 === true, evidence: "" }, c2: { value: f.c2 === true, evidence: "" } };
    const result = { version: "human-1", mode: a.mode, items, flags, metrics: metricsOf(items), note: String(req.body?.note || "").slice(0, 1000) };
    await store.saveGrading(a.id, "human", result, "human", "human-1");
    return { grading: result };
  },

  // Сравнение первого прохождения и повтора у каждого резидента (тестовые ID на T по умолчанию исключены)
  async "GET admin/compare"(req, store) {
    const includeTest = param(req, "include_test") === "1";
    const residents = Object.fromEntries((await store.listResidents()).map((r) => [r.id, r]));
    const attempts = await store.listAttempts();
    const gr = await gradingsByAttempt(store);
    const pairs = [];
    for (const first of attempts.filter((x) => x.mode === "tutored")) {
      if (!includeTest && first.resident_id.startsWith("T")) continue;
      const retest = attempts.find((x) => x.mode === "retest" && x.resident_id === first.resident_id && x.case_id === first.case_id);
      const e1 = effectiveOf(gr[first.id]);
      const e2 = retest ? effectiveOf(gr[retest.id]) : null;
      if (!retest || !e1 || !e2) continue;
      pairs.push({
        resident_id: first.resident_id, pgy: residents[first.resident_id]?.pgy ?? null, case_id: first.case_id,
        source: { first: e1.kind, retest: e2.kind },
        comparison: compareGradings(CASES[first.case_id], e1.result, e2.result),
      });
    }
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const transitions = {};
    for (const p of pairs) for (const [k, v] of Object.entries(p.comparison.counts)) transitions[k] = (transitions[k] || 0) + v;
    return {
      pairs,
      group: {
        n: pairs.length,
        independence: { first: mean(pairs.map((p) => p.comparison.first.independence)), retest: mean(pairs.map((p) => p.comparison.retest.independence)) },
        weighted: { first: mean(pairs.map((p) => p.comparison.first.weighted)), retest: mean(pairs.map((p) => p.comparison.retest.weighted)) },
        transitions,
      },
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
    // Администратору показываем настоящую причину, резиденту нет
    const isAdminRoute = String(routeOf(req)).startsWith("admin/") && isAdmin(req);
    return res.status(500).json({ error: isAdminRoute ? `Ошибка: ${err?.message}` : "Внутренняя ошибка сервера" });
  }
}
