// Аудит выгрузки JSON (/study/admin → Скачать JSON): соблюдает ли преподаватель правила и сколько это стоило.
// Запуск: node scripts/audit-transcript.mjs путь/к/выгрузке.json
// Проверки эвристические: они находят подозрительные места для ручного просмотра, а не выносят приговор.
import { readFileSync } from "node:fs";

// $ за миллион токенов: вход, выход. Кэш: запись ×1.25, чтение ×0.1 от цены входа.
const PRICE = { "claude-sonnet-5": [2, 10], "claude-haiku-4-5": [1, 5], "claude-opus-5": [5, 25] };
const priceOf = (model) => PRICE[Object.keys(PRICE).find((k) => String(model).startsWith(k))] || null;

const EVAL_WORDS = /(?<![\p{L}])(верно|правильно|именно|хорошо|согласен|разумно|логично|отлично|молодец)(?![\p{L}])/giu;
// Термин в реплике преподавателя без соответствующего запроса резидента в предыдущей реплике = возможная лишняя выдача
const DISCLOSURE = [
  ["тропонин", /тропонин/i, /тропонин/i],
  ["удельный вес мочи", /удельн\S* вес/i, /удельн|моч|оам/i],
  ["ЭКГ", /экг|ээг/i, /экг/i],
  ["вены шеи", /вен\S* шеи|яремн/i, /вен|шеи|яремн|jvp/i],
  ["лёгкие/хрипы", /хрип|везикуляр/i, /легк|лёгк|хрип|аускульт|дыхан/i],
  ["тоны сердца/S3", /(?<![\p{L}\d])s3(?![\p{L}\d])|тоны сердца/iu, /тон|сердц|аускульт|s3/i],
  ["анионная разница (готовый расчёт)", /анионн\S* разниц\S*[^.]{0,40}=|138\s*[−-]\s*110/i, /анион/i],
  ["ОПП/KDIGO (готовая трактовка)", /kdigo|повреждени\S* почек|(?<![\p{L}])опп(?![\p{L}])/iu, /опп|kdigo|повреждени/i],
];

const file = process.argv[2];
if (!file) { console.error("Укажите путь к JSON выгрузки"); process.exit(1); }
const data = JSON.parse(readFileSync(file, "utf8"));

for (const a of data.attempts) {
  const T = a.transcript;
  const tutorMsgs = T.map((m, i) => ({ m, i })).filter(({ m }) => m.role === "assistant" && !m.kind);
  const models = [...new Set(T.filter((m) => m.model).map((m) => m.model))];
  console.log(`\n=== ${a.resident_id} · ${a.case_id} v${a.case_version} · ${a.mode} · ${a.status} · модель: ${models.join(", ") || "?"} · промпт: ${[...new Set(T.map((m) => m.prompt_version).filter(Boolean))].join(", ")}`);

  const multiQ = tutorMsgs.filter(({ m }) => (m.content.match(/\?/g) || []).length > 1).length;
  const evalHits = tutorMsgs.map(({ m, i }) => ({ i, w: m.content.match(EVAL_WORDS) })).filter((x) => x.w);
  const truncated = T.filter((m) => m.truncated || m.stop_reason === "max_tokens").length;
  const hinted = tutorMsgs.filter(({ m }) => m.hints?.length);
  console.log(`реплик преподавателя: ${tutorMsgs.length}; со средней длиной ${Math.round(tutorMsgs.reduce((s, { m }) => s + m.content.length, 0) / Math.max(1, tutorMsgs.length))} символов`);
  console.log(`несколько вопросов в одной реплике: ${multiQ} из ${tutorMsgs.length}`);
  console.log(`оценочные слова («верно», «правильно»…): ${evalHits.length} реплик${evalHits.length ? " → #" + evalHits.map((x) => `${x.i} (${[...new Set(x.w.map((w) => w.toLowerCase()))].join(", ")})`).join("; #") : ""}`);
  console.log(`обрезанных ответов: ${truncated}`);
  if (a.mode === "retest") console.log(`метки подсказок в повторе (должно быть 0): ${hinted.length}`);
  else console.log(`реплик с метками подсказок: ${hinted.length} (уровни: ${hinted.flatMap(({ m }) => m.hints.map((h) => h.level)).join(",") || "—"})`);

  const leaks = [];
  for (const { m, i } of tutorMsgs) {
    const prevUser = [...T.slice(0, i)].reverse().find((x) => x.role === "user")?.content || "";
    for (const [name, inAssistant, inRequest] of DISCLOSURE) {
      if (inAssistant.test(m.content) && !inRequest.test(prevUser)) leaks.push(`#${i}: ${name}`);
    }
  }
  console.log(`возможная лишняя выдача или готовая трактовка: ${leaks.length}${leaks.length ? " → " + leaks.join("; ") : ""}`);

  const sums = { in: 0, cw: 0, cr: 0, out: 0 };
  let cost = 0, priced = true;
  for (const m of T) {
    if (!m.usage) continue;
    const p = priceOf(m.model);
    if (!p) { priced = false; continue; }
    const u = m.usage;
    cost += ((u.input_tokens || 0) * p[0] + (u.cache_creation_input_tokens || 0) * p[0] * 1.25 + (u.cache_read_input_tokens || 0) * p[0] * 0.1 + (u.output_tokens || 0) * p[1]) / 1e6;
    sums.in += u.input_tokens || 0; sums.cw += u.cache_creation_input_tokens || 0; sums.cr += u.cache_read_input_tokens || 0; sums.out += u.output_tokens || 0;
  }
  console.log(`токены: вход ${sums.in}, запись в кэш ${sums.cw}, чтение из кэша ${sums.cr}, выход ${sums.out}`);
  console.log(`стоимость диалога и разбора: ≈ ${cost.toFixed(2)} $${priced ? "" : " (для части моделей цена неизвестна)"}`);
}
