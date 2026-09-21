// Логика оценки без модели: node scripts/test-grader.mjs
import { finalizeGrading, transitionName, metricsOf, extractJson } from "../api/_lib/grader.js";
import { CASES } from "../api/_lib/cases.generated.js";
import { modelFor } from "../api/_lib/tutor.js";

let fails = 0;
const ok = (c, n) => { console.log(`${c ? "ok  " : "FAIL"} ${n}`); if (!c) fails++; };
const kase = CASES["fluids-01"];
const raw = (over = {}) => ({
  items: kase.rubric.map((r) => ({ n: r.n, score: 0, evidence: "", ...(over[r.n] || {}) })),
  flags: { c1: { value: false }, c2: { value: false } },
});
const T = [
  { role: "assistant", content: "Открытие", kind: "opening" },
  { role: "user", content: "Проверю проходимость катетера" },                       // 1
  { role: "assistant", content: "Что ещё осмотрите?", hints: [{ item: 3, level: 1 }] }, // 2
  { role: "user", content: "Оценю капиллярное наполнение и слизистые" },             // 3
  { role: "user", content: "болюс 500 мл рингер-лактата быстро" },                    // 4
];

let g = finalizeGrading(kase, "tutored", T, raw({ 2: { score: 2, evidence: "проходимость катетера" } }));
ok(g.items.find((i) => i.n === 2).score === 2, "цитата найдена (без учёта регистра): 2 сохраняется");

g = finalizeGrading(kase, "tutored", T, raw({ 2: { score: 2, evidence: "измерю центральное венозное давление" } }));
ok(g.items.find((i) => i.n === 2).score === 0 && g.items.find((i) => i.n === 2).flags.includes("evidence_not_found"), "цитаты нет в репликах резидента: балл обнуляется");

g = finalizeGrading(kase, "tutored", T, raw({ 3: { score: 2, evidence: "капиллярное наполнение" } }));
const i3 = g.items.find((i) => i.n === 3);
ok(i3.score === 1 && i3.flags.includes("downgraded_by_hint_tag") && i3.hint_level === 1, "подсказка по пункту раньше цитаты: 2 понижается до 1");

g = finalizeGrading(kase, "tutored", T, raw({ 7: { score: 2, evidence: "болюс 500 мл" } }));
ok(g.items.find((i) => i.n === 7).score === 2, "пункт без подсказки остаётся 2");

g = finalizeGrading(kase, "retest", T, raw({ 7: { score: 1, evidence: "болюс 500 мл" } }));
ok(g.items.find((i) => i.n === 7).score === 0, "в повторе 1 превращается в 0");

const foreign = [{ role: "assistant", content: "Расчёт: 138−110−18 = 10, нормальный anion gap" }, { role: "user", content: "ок" }];
g = finalizeGrading(kase, "tutored", foreign, raw({ 10: { score: 2, evidence: "нормальный anion gap" } }));
ok(g.items.find((i) => i.n === 10).score === 0, "цитата из реплики преподавателя не засчитывается");

ok(finalizeGrading(kase, "tutored", T, raw()).items.length === 14, "всегда 14 пунктов, даже если модель пропустила");
const w = metricsOf(kase.rubric.map((r) => ({ n: r.n, weight: r.weight, score: 2 })));
ok(w.weighted === 1 && w.independence === 1, "все пункты 2: вес 100 %");
const w2 = metricsOf(kase.rubric.map((r) => ({ n: r.n, weight: r.weight, score: r.n === 7 ? 2 : 0 })));
ok(Math.abs(w2.weighted - 3 / 27) < 1e-9, "только болюс (вес 3): 3/27");

const pairs = [[2, 2, "удержано"], [2, 0, "потеряно"], [1, 2, "закреплено после подсказки"], [1, 0, "не закреплено после подсказки"], [0, 2, "усвоено"], [0, 0, "не усвоено"]];
ok(pairs.every(([a, b, n]) => transitionName(a, b) === n), "шесть категорий перехода между попытками");

ok(extractJson('Вот оценка:\n```json\n{"items":[],"flags":{}}\n```\nготово').items.length === 0, "JSON достаётся из ответа с markdown-обёрткой и лишним текстом");
let msg = ""; try { extractJson("нет json"); } catch (e) { msg = e.message; }
ok(msg.includes("без JSON"), "ответ без JSON даёт понятную ошибку");
msg = ""; try { extractJson('{"items":[{"n":1,"evidence":"обрыв'); } catch (e) { msg = e.message; }
ok(msg.includes("без JSON") || msg.includes("некорректный JSON"), "обрезанный JSON даёт понятную ошибку");
ok(finalizeGrading(kase, "tutored", T, { items: "не массив" }).items.length === 14, "items не массивом не ломает разбор");
ok(finalizeGrading(kase, "tutored", T, null).items.length === 14, "пустой ответ не ломает разбор");

delete process.env.STUDY_MODEL; delete process.env.STUDY_TUTOR_MODEL; delete process.env.STUDY_GRADER_MODEL; delete process.env.STUDY_TRIAL_MODEL;
ok(modelFor("tutor", "R01") === "claude-sonnet-5" && modelFor("grader", "R01") === "claude-sonnet-5", "обычный резидент: Sonnet 5 для преподавателя и оценщика");
ok(modelFor("tutor", "TH1") === "claude-haiku-4-5" && modelFor("tutor", "th2") === "claude-haiku-4-5", "тестовый ID на TH: преподаватель на Haiku 4.5");
ok(modelFor("grader", "TH1") === "claude-sonnet-5", "оценщик у TH остаётся на Sonnet (сравнивается только преподаватель)");
ok(modelFor("tutor", "T01") === "claude-sonnet-5" && modelFor("tutor", "R05") === "claude-sonnet-5", "прочие тестовые и настоящие ID не затронуты");

console.log(fails ? `\n${fails} тест(ов) не прошло` : "\nВсе проверки пройдены");
process.exit(fails ? 1 : 0);
