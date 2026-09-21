// Проверяет оценки, сделанные вне сервера, теми же проверками кодом, и собирает файл для загрузки в /study/admin.
// node scripts/preview-gradings.mjs выгрузка.json мои-оценки.json [--out gradings-import.json] [--grader "claude-code-session (модель)"]
// Формат мои-оценки.json: { "<attempt_id>": { "items":[{"n":1,"score":2,"hint_level":0,"evidence":"цитата резидента","reason":"до 12 слов"}, ...14...],
//                                            "flags":{"c1":{"value":false,"evidence":""},"c2":{"value":false,"evidence":""}} } }
import { readFileSync, writeFileSync } from "node:fs";
import { CASES } from "../api/_lib/cases.generated.js";
import { finalizeGrading } from "../api/_lib/grader.js";

const args = process.argv.slice(2);
const [exportFile, gradesFile] = args;
if (!exportFile || !gradesFile) { console.error("Использование: preview-gradings.mjs выгрузка.json мои-оценки.json [--out файл] [--grader метка]"); process.exit(1); }
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const out = opt("--out") || `gradings-import-${new Date().toISOString().slice(0, 10)}.json`;
const grader = opt("--grader") || "claude-code-session";

const data = JSON.parse(readFileSync(exportFile, "utf8"));
const grades = JSON.parse(readFileSync(gradesFile, "utf8"));
const results = [];
let problems = 0;

for (const [id, raw] of Object.entries(grades)) {
  const a = data.attempts.find((x) => x.id === id);
  if (!a) { console.log(`!!! ${id}: нет в выгрузке`); problems++; continue; }
  const kase = CASES[a.case_id];
  const given = new Set((raw.items || []).map((i) => Number(i.n)));
  const missing = kase.rubric.filter((r) => !given.has(r.n)).map((r) => r.n);
  if (missing.length) { console.log(`!!! ${id}: не оценены пункты ${missing.join(", ")} (получат 0)`); problems++; }
  const res = finalizeGrading(kase, a.mode, a.transcript, raw);
  const changed = res.items.filter((i) => i.flags.length);
  const m = res.metrics;
  console.log(`\n== ${a.resident_id} · ${a.mode} · ${id}`);
  console.log(`   самостоятельность ${Math.round(m.independence * 100)}% · общий балл ${Math.round(m.weighted * 100)}% · сам ${m.self_items}, после подсказки ${m.hint_items}, нет ${m.missed_items}`);
  console.log(`   флаги: C1 ${res.flags.c1.value ? "ДА" : "нет"} · C2 ${res.flags.c2.value ? "ДА" : "нет"}`);
  for (const i of changed) {
    const before = (raw.items || []).find((x) => Number(x.n) === i.n)?.score;
    console.log(`   пункт ${i.n}: ${before} → ${i.score} (${i.flags.join(", ")})`);
  }
  if (changed.length) problems += changed.length;
  results.push({ attempt_id: id, raw });
}

writeFileSync(out, JSON.stringify({ grader, results }, null, 2));
console.log(`\nФайл для загрузки: ${out} (${results.length} оценок). ${problems ? `Замечаний: ${problems} (проверки кодом изменили или отметили баллы, см. выше).` : "Замечаний нет."}`);
