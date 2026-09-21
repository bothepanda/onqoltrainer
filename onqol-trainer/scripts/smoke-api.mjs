// Дымовой тест: node scripts/dev-api.mjs (с STUDY_MOCK=1 ADMIN_TOKEN=test) и в другом окне node scripts/smoke-api.mjs
const BASE = process.env.BASE || "http://localhost:3001/api/study";
const ADMIN = process.env.ADMIN_TOKEN || "test";
let fails = 0;
const ok = (cond, name) => { console.log(`${cond ? "ok  " : "FAIL"} ${name}`); if (!cond) fails++; };

async function call(method, path, { body, token, admin } = {}) {
  const r = await fetch(`${BASE}/${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(admin ? { "x-admin-token": admin } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, json, text };
}

const stamp = Date.now().toString(36).slice(-4).toUpperCase();
const ids = { r: "R" + stamp, t1: "T" + stamp + "1", t2: "T" + stamp + "2" };

// админ
ok((await call("GET", "admin/overview")).status === 401, "админ без токена: 401");
const made = await call("POST", "admin/residents", { admin: ADMIN, body: { residents: [{ id: ids.r, pgy: 2 }, { id: ids.t1, pgy: 4 }, { id: ids.t2, pgy: 3 }] } });
ok(made.status === 200 && made.json.residents.every((x) => /^\d{6}$/.test(x.pin)), "создание резидентов, PIN из 6 цифр");
const pin = Object.fromEntries(made.json.residents.map((x) => [x.id, x.pin]));

// вход
ok((await call("POST", "login", { body: { id: ids.r, pin: "000000" } })).status === 401, "неверный PIN: 401");
const login = await call("POST", "login", { body: { id: ids.r.toLowerCase(), pin: pin[ids.r] } });
ok(login.status === 200 && login.json.token, "вход по ID и PIN (ID нечувствителен к регистру)");
const tok = login.json.token;
ok((await call("GET", "home")).status === 401, "без токена: 401");

// доступ по дате: обычный резидент до 25.09 ничего не видит, тестовый (T...) видит
const homeR = await call("GET", "home", { token: tok });
const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
ok(today >= "2026-09-25" ? homeR.json.items.length > 0 : homeR.json.items.length === 0, `до даты сессии кейс скрыт (сегодня ${today})`);

const t1 = (await call("POST", "login", { body: { id: ids.t1, pin: pin[ids.t1] } })).json.token;
const home1 = await call("GET", "home", { token: t1 });
ok(home1.json.items.length === 2, "тестовый пользователь видит оба задания");
ok(home1.json.items.find((i) => i.mode === "retest").locked === true, "повтор заблокирован до первого прохождения");

// согласие
const startNoConsent = await call("POST", "start", { token: t1, body: { case_id: "fluids-01", mode: "tutored" } });
ok(startNoConsent.status === 403, "без согласия кейс не стартует");
await call("POST", "consent", { token: t1 });
const st = await call("POST", "start", { token: t1, body: { case_id: "fluids-01", mode: "tutored" } });
ok(st.status === 200 && st.json.attempt.transcript.length === 1 && st.json.attempt.transcript[0].role === "assistant", "старт: открытие кейса из утверждённого текста");
const aid = st.json.attempt.id;
const again = await call("POST", "start", { token: t1, body: { case_id: "fluids-01", mode: "tutored" } });
ok(again.json.attempt.id === aid, "повторный старт возвращает ту же попытку");

// переписка
const c1 = await call("POST", "chat", { token: t1, body: { attempt_id: aid, text: "Прошу подсказку", expected_len: 1 } });
ok(c1.status === 200 && c1.json.length === 3 && !c1.json.reply.includes("<<HINT"), "реплика сохранена, служебная метка скрыта от резидента");
ok((await call("POST", "chat", { token: t1, body: { attempt_id: aid, text: "дубль", expected_len: 1 } })).status === 409, "двойная отправка отклонена (409)");
ok((await call("POST", "chat", { token: tok, body: { attempt_id: aid, text: "чужая", expected_len: 3 } })).status === 404, "чужая попытка недоступна");
const view = await call("GET", `attempt?id=${aid}`, { token: t1 });
ok(view.json.attempt.transcript.length === 3 && view.json.attempt.transcript.every((m) => !("hints" in m)), "восстановление после перезагрузки; метки подсказок не отдаются клиенту");

// завершение и отправка
ok((await call("POST", "submit", { token: t1, body: { attempt_id: aid } })).status === 409, "отправка до завершения запрещена");
const fin = await call("POST", "chat", { token: t1, body: { attempt_id: aid, text: "конец кейса", expected_len: 3 } });
ok(fin.status === 200 && fin.json.attempt.status === "finished" && fin.json.attempt.transcript.at(-1).kind === "debrief", "«конец кейса» завершает и даёт разбор");
ok((await call("POST", "chat", { token: t1, body: { attempt_id: aid, text: "ещё", expected_len: 5 } })).status === 409, "после завершения писать нельзя");
const sub = await call("POST", "submit", { token: t1, body: { attempt_id: aid } });
ok(sub.json.attempt.status === "submitted", "отправка разработчику");

// повтор
const home2 = await call("GET", "home", { token: t1 });
ok(home2.json.items.find((i) => i.mode === "retest").locked === false, "повтор открылся после первого прохождения");
const t2 = (await call("POST", "login", { body: { id: ids.t2, pin: pin[ids.t2] } })).json.token;
await call("POST", "consent", { token: t2 });
ok((await call("POST", "start", { token: t2, body: { case_id: "fluids-01", mode: "retest" } })).status === 409, "повтор без первого прохождения: 409");
const rt = await call("POST", "start", { token: t1, body: { case_id: "fluids-01", mode: "retest" } });
const rc = await call("POST", "chat", { token: t1, body: { attempt_id: rt.json.attempt.id, text: "Прошу подсказку", expected_len: 1 } });
ok(rc.status === 200, "повтор стартует");
const fin2 = await call("POST", "chat", { token: t1, body: { attempt_id: rt.json.attempt.id, text: "Завершить, дай разбор", expected_len: 3 } });
ok(fin2.status === 200 && fin2.json.attempt?.status === "finished", "«Завершить, дай разбор» текстом завершает кейс, а не уходит в модель");

// выгрузка
const exp = await call("GET", "admin/export", { admin: ADMIN });
const first = exp.json.attempts.find((a) => a.id === aid);
ok(first && first.case_version && first.case_hash && first.transcript.some((m) => m.hints), "выгрузка JSON: версия и хэш кейса, метки подсказок");
const retest = exp.json.attempts.find((a) => a.id === rt.json.attempt.id);
ok(retest && !retest.transcript.some((m) => m.hints), "в режиме повтора подсказки не фиксируются");
const csv = await call("GET", "admin/export?format=csv", { admin: ADMIN });
ok(csv.text.replace(/^\uFEFF/, "").split("\n")[0].startsWith("resident_id,pgy") && csv.text.includes(aid), "выгрузка CSV");

// оценка по рубрике (в тесте оценщик — заглушка)
const gA = await call("GET", `admin/grading?attempt_id=${aid}`, { admin: ADMIN });
ok(gA.status === 200 && gA.json.model && gA.json.rubric.length === 14 && gA.json.model.items.length === 14, "оценка создаётся автоматически при завершении (14 пунктов)");
const it14 = gA.json.model.items.find((i) => i.n === 14);
ok(it14.score === 0 && it14.flags.includes("evidence_not_found"), "выдуманная цитата не засчитывается кодом");
ok(gA.json.model.items.find((i) => i.n === 1).score === 2 && gA.json.model.metrics.weighted > 0, "цитата из реплики резидента засчитывается, метрики посчитаны");
const gB = await call("GET", `admin/grading?attempt_id=${rt.json.attempt.id}`, { admin: ADMIN });
ok(gB.json.model.items.every((i) => i.score !== 1), "в повторе частичного балла нет");
ok((await call("POST", "admin/grade-review", { admin: ADMIN, body: { attempt_id: rt.json.attempt.id, items: [{ n: 2, score: 1 }] } })).status === 400, "ручная проверка отклоняет балл 1 в повторе");
const rev = await call("POST", "admin/grade-review", { admin: ADMIN, body: { attempt_id: aid, items: [{ n: 1, score: 1 }], flags: { c1: true }, note: "проверка" } });
ok(rev.status === 200 && rev.json.grading.items.find((i) => i.n === 1).score === 1 && rev.json.grading.flags.c1.value, "ручная проверка сохраняется");
const cmp = await call("GET", "admin/compare?include_test=1", { admin: ADMIN });
const pair = cmp.json.pairs.find((p) => p.resident_id === ids.t1);
ok(pair && pair.comparison.rows.length === 14 && pair.source.first === "human" && pair.source.retest === "model", "сравнение: проверенная человеком оценка важнее модели");
ok(pair.comparison.counts && Object.keys(pair.comparison.counts).length > 0 && cmp.json.group.n >= 1, "сравнение: категории переходов и итог по группе");
ok((await call("GET", "admin/compare", { admin: ADMIN })).json.pairs.every((p) => !p.resident_id.startsWith("T")), "тестовые ID по умолчанию исключены из сравнения");
ok((await call("POST", "admin/grade", { admin: ADMIN, body: { attempt_id: aid } })).status === 200, "повторная оценка моделью по запросу администратора");

// блокировка PIN
for (let i = 0; i < 5; i++) await call("POST", "login", { body: { id: ids.t2, pin: "111111" } });
ok((await call("POST", "login", { body: { id: ids.t2, pin: pin[ids.t2] } })).status === 429, "после 5 неверных PIN вход блокируется");

// сброс
ok((await call("POST", "admin/reset", { admin: ADMIN, body: { attempt_id: rt.json.attempt.id } })).status === 200, "админ может сбросить попытку");

console.log(fails ? `\n${fails} тест(ов) не прошло` : "\nВсе проверки пройдены");
process.exit(fails ? 1 : 0);
