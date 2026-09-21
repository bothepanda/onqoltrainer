// Готовит транскрипты выгрузки для оценки (читает оценивающий в сессии Claude Code).
// node scripts/prepare-grading.mjs выгрузка.json                (только неоценённые завершённые попытки)
// node scripts/prepare-grading.mjs выгрузка.json --all          (все завершённые)
// node scripts/prepare-grading.mjs выгрузка.json --attempt <id>  (одна попытка)
import { readFileSync } from "node:fs";
import { CASES } from "../api/_lib/cases.generated.js";
import { transcriptForGrader } from "../api/_lib/grader.js";

const [file, ...rest] = process.argv.slice(2);
if (!file) { console.error("Укажите путь к выгрузке JSON"); process.exit(1); }
const all = rest.includes("--all");
const only = rest.includes("--attempt") ? rest[rest.indexOf("--attempt") + 1] : null;
const data = JSON.parse(readFileSync(file, "utf8"));

const todo = data.attempts.filter((a) => {
  if (only) return a.id === only;
  if (a.status === "draft") return false;
  return all || (!a.grading?.model && !a.grading?.human);
});
if (!todo.length) { console.log("Нет попыток для оценки."); process.exit(0); }

const printedCases = new Set();
for (const a of todo) {
  const kase = CASES[a.case_id];
  if (!kase) { console.log(`\n!!! ${a.id}: кейс ${a.case_id} не найден в проекте`); continue; }
  if (!printedCases.has(a.case_id)) {
    printedCases.add(a.case_id);
    console.log(`\n##### РУБРИКА ${a.case_id} v${kase.version} (${kase.rubric.length} пунктов)`);
    for (const r of kase.rubric) console.log(`${r.n}. ${r.text} (вес ${r.weight})`);
  }
  if (a.case_version !== kase.version) console.log(`\n!!! ${a.id}: попытка пройдена по v${a.case_version}, в проекте сейчас v${kase.version}`);
  console.log(`\n##### ПОПЫТКА ${a.id} · ${a.resident_id} (год ${a.pgy ?? "?"}) · режим: ${a.mode === "retest" ? "ПОВТОР (подсказок нет)" : "ОБУЧАЮЩИЙ"} · статус ${a.status}`);
  console.log(transcriptForGrader(a.transcript));
}
console.log(`\nПопыток к оценке: ${todo.length}`);
