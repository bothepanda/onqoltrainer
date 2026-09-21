// Независимая оценка попытки по рубрике кейса.
// Модель предлагает оценку с цитатами, КОД проверяет цитаты и понижает завышенные баллы.
import { callModel } from "./tutor.js";

export const GRADER_VERSION = "grade-1.2";

const RULES = `Ты — НЕЗАВИСИМЫЙ ОЦЕНЩИК клинической работы резидента. Ты не преподаватель и не обращаешься к резиденту. Оцени, что резидент сделал в переписке, по рубрике кейса.

Правила оценки:
- Оценивай ТОЛЬКО реплики резидента (метка РЕЗИДЕНТ). Реплики преподавателя — контекст. Данные, которые преподаватель выдал по запросу резидента, — не подсказка; сам запрос резидента (например, «проверить вены шеи») — его действие.
- Счёт пункта: 2 = резидент назвал или сделал это САМ, до того как преподаватель упомянул тему или задал наводящий вопрос; 1 = только после наводящего вопроса, подсказки или готовой интерпретации преподавателя; 0 = не сделал, сделал неверно, или сказал только после того, как преподаватель сам назвал ответ. В режиме ПОВТОР допустимы только 0 и 2.
- Подсказкой считается любая реплика преподавателя, наводящая на пункт или раскрывающая его (вопрос «а вы проверили X?», выбор из вариантов, готовый расчёт или вывод), даже без пометки.
- Для каждого пункта со счётом 1 или 2 обязательна ЦИТАТА: точная подстрока из реплики РЕЗИДЕНТА (до 200 символов), подтверждающая пункт. Не перефразируй и не склеивай. Если цитаты нет — счёт 0.
- Не засчитывай отсутствие ошибки как выполнение. Не засчитывай то, что резидент лишь повторил за преподавателем после его объяснения.
- Пункты, сформулированные как воздержание от действия (например, «не использует диуретик как лечение гиповолемической олигурии»): 2 ставь только если резидент ЯВНО отказался от этого действия или ЯВНО назвал верную альтернативу как лечение причины (например, сказал, что олигурия здесь следствие гиповолемии и лечится оценкой перфузии и объёмом). Если резидент об этом просто не говорил, счёт 0: молчание не засчитывается. Если он выполнил запрещённое действие, счёт 0 и поставь соответствующий флаг критической ошибки. 1 — если явный отказ или альтернатива прозвучали только после наводящего вопроса.
- hint_level: наибольший уровень подсказки по этому пункту (0 — не было; 1 — общий наводящий вопрос; 2 — прямой вопрос о пропущенном; 3 — прямое указание или готовая интерпретация).
- Флаги критических ошибок (отдельно от баллов): c1 — резидент назначил диуретик (в том числе фуросемид) до оценки или коррекции подозреваемой гиповолемии; c2 — резидент продолжил повторные болюсы после появления признаков перегрузки. Для каждого дай value (true/false) и краткое evidence (цитата или пустая строка).

Верни ТОЛЬКО один JSON без комментариев и без markdown, строго в формате:
{"items":[{"n":1,"score":0,"hint_level":0,"evidence":"","reason":"до 12 слов"}, ...по одному объекту на каждый пункт рубрики...],"flags":{"c1":{"value":false,"evidence":""},"c2":{"value":false,"evidence":""}}}`;

export function buildGraderSystem(kase, mode) {
  const rubric = kase.rubric.map((r) => `${r.n}. ${r.text} (вес ${r.weight})`).join("\n");
  return [
    RULES,
    `РЕЖИМ ПОПЫТКИ: ${mode === "retest" ? "ПОВТОР (подсказок не было)" : "ОБУЧАЮЩИЙ (подсказки были возможны)"}`,
    `РУБРИКА (${kase.rubric.length} пунктов):\n${rubric}`,
    "=== ДОСЬЕ КЕЙСА (эталон содержания) ===\n" + kase.dossier,
  ].join("\n\n");
}

// Разбор для оценщика: нумерованные реплики, подсказки помечены. Разбор преподавателя и служебные реплики не включаем.
export function transcriptForGrader(transcript) {
  return transcript
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.kind !== "finish" && m.kind !== "debrief")
    .map(({ m, i }) => {
      const who = m.role === "user" ? "РЕЗИДЕНТ" : "ПРЕПОДАВАТЕЛЬ";
      const tag = m.hints?.length ? ` подсказка: ${m.hints.map((h) => `ур.${h.level} пункт ${h.item}`).join("; ")}` : "";
      return `[#${i} ${who}${tag}] ${m.content}`;
    })
    .join("\n\n");
}

export function extractJson(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "");
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a === -1 || b <= a) throw new Error(`Оценщик вернул ответ без JSON. Начало ответа: «${t.slice(0, 200)}»`);
  try {
    return JSON.parse(t.slice(a, b + 1));
  } catch (e) {
    throw new Error(`Оценщик вернул некорректный JSON (${e.message}). Начало ответа: «${t.slice(a, a + 200)}»`, { cause: e });
  }
}

const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

// Проверки кодом: цитата обязана быть в реплике резидента; подсказка по пункту раньше цитаты понижает 2 до 1;
// в повторе частичный балл невозможен.
export function finalizeGrading(kase, mode, transcript, raw) {
  const residentMsgs = transcript.map((m, i) => ({ m, i })).filter(({ m }) => m.role === "user" && !m.kind);
  const rawItems = Array.isArray(raw?.items) ? raw.items : [];
  const items = kase.rubric.map((r) => {
    const g = rawItems.find((x) => Number(x.n) === r.n) || {};
    let score = [0, 1, 2].includes(Number(g.score)) ? Number(g.score) : 0;
    const flags = [];
    const evidence = String(g.evidence || "").slice(0, 400);
    let evidenceMsg = null;

    if (score > 0) {
      const needle = norm(evidence);
      const hit = needle.length >= 3 ? residentMsgs.find(({ m }) => norm(m.content).includes(needle)) : null;
      if (hit) evidenceMsg = hit.i;
      else { score = 0; flags.push("evidence_not_found"); }
    }
    if (mode === "retest" && score === 1) { score = 0; flags.push("retest_partial_to_0"); }

    const tagged = transcript.flatMap((m, i) => (m.hints || []).filter((h) => h.item === r.n).map((h) => ({ i, level: h.level })));
    if (mode === "tutored" && score === 2 && evidenceMsg != null && tagged.some((t) => t.i < evidenceMsg)) {
      score = 1; flags.push("downgraded_by_hint_tag");
    }
    const hintLevel = Math.max(Number(g.hint_level) || 0, ...tagged.map((t) => t.level), 0);
    return { n: r.n, weight: r.weight, score, hint_level: hintLevel, evidence, evidence_msg: evidenceMsg, reason: String(g.reason || "").slice(0, 400), flags };
  });
  const flagsOut = {};
  for (const k of ["c1", "c2"]) {
    const f = raw?.flags?.[k] || {};
    flagsOut[k] = { value: f.value === true, evidence: String(f.evidence || "").slice(0, 400) };
  }
  return { version: GRADER_VERSION, mode, items, flags: flagsOut, metrics: metricsOf(items) };
}

export function metricsOf(items) {
  const totalW = items.reduce((a, i) => a + i.weight, 0);
  return {
    independence: items.filter((i) => i.score === 2).length / items.length,
    weighted: totalW ? items.reduce((a, i) => a + (i.weight * i.score) / 2, 0) / totalW : 0,
    self_items: items.filter((i) => i.score === 2).length,
    hint_items: items.filter((i) => i.score === 1).length,
    missed_items: items.filter((i) => i.score === 0).length,
  };
}

// Размышление отключено: у Sonnet 5 оно делит с ответом лимит токенов и в прошлом запуске съело его целиком до JSON.
// Качество держат явные правила, обязательные цитаты и проверки кодом.
export async function runGrader(kase, mode, transcript, { timeoutMs = 45000 } = {}) {
  const out = await callModel({
    system: buildGraderSystem(kase, mode),
    messages: [{ role: "user", content: `ПЕРЕПИСКА:\n\n${transcriptForGrader(transcript)}\n\nВерни JSON оценки.` }],
    maxTokens: 6000,
    thinking: "disabled",
    role: "grader",
    timeoutMs,
    retries: 0,
  });
  if (out.stop_reason === "max_tokens") {
    throw new Error("Ответ оценщика обрезан по лимиту токенов (max_tokens). Увеличьте лимит или сократите переписку.");
  }
  const result = finalizeGrading(kase, mode, transcript, extractJson(out.text));
  return { result, model: out.model };
}

// Категории перехода между первой попыткой и повтором
export function transitionName(first, retest) {
  if (first === 2 && retest === 2) return "удержано";
  if (first === 2 && retest === 0) return "потеряно";
  if (first === 1 && retest === 2) return "закреплено после подсказки";
  if (first === 1 && retest === 0) return "не закреплено после подсказки";
  if (first === 0 && retest === 2) return "усвоено";
  if (first === 0 && retest === 0) return "не усвоено";
  return "частично";
}

export function compareGradings(kase, first, retest) {
  const rows = kase.rubric.map((r) => {
    const a = first.items.find((i) => i.n === r.n)?.score ?? 0;
    const b = retest.items.find((i) => i.n === r.n)?.score ?? 0;
    return { n: r.n, text: r.text, weight: r.weight, first: a, retest: b, transition: transitionName(a, b) };
  });
  const counts = {};
  for (const r of rows) counts[r.transition] = (counts[r.transition] || 0) + 1;
  return {
    rows,
    counts,
    first: metricsOf(first.items),
    retest: metricsOf(retest.items),
    flags: { first: first.flags, retest: retest.flags },
  };
}

// Для дебрифа резидента: без чисел и весов, только содержание
export function gradingForDebrief(kase, grading, mode) {
  const status = (s) => (s === 2 ? "сделал сам" : s === 1 ? "только после подсказки" : "не сделал");
  return JSON.stringify({
    режим: mode === "retest" ? "повтор без подсказок" : "обучающий",
    пункты: grading.items.map((i) => ({
      что: kase.rubric.find((r) => r.n === i.n)?.text,
      итог: mode === "retest" && i.score === 1 ? "не сделал" : status(i.score),
      цитата_резидента: i.evidence || undefined,
    })),
    критические_ошибки: Object.entries(grading.flags).filter(([, f]) => f.value).map(([k]) => (k === "c1" ? "диуретик до коррекции гиповолемии" : "болюсы при признаках перегрузки")),
  });
}
