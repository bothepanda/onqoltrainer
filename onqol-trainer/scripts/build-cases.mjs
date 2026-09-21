// Превращает утверждённые кейсы (cases/*.md) в модуль для серверных функций.
// Хэш sha256 каждого кейса пишется в данные попытки, чтобы всегда было видно,
// по какой именно версии текста проходил резидент.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const casesDir = join(root, "cases");
const outFile = join(root, "api", "_lib", "cases.generated.js");

const cases = {};
for (const file of readdirSync(casesDir).filter((f) => f.endsWith(".md")).sort()) {
  const md = readFileSync(join(casesDir, file), "utf8");
  const head = md.match(/^# Кейс ([a-z0-9-]+)\s*·\s*(.+)$/m);
  const version = md.match(/\*\*Версия:\*\*\s*([0-9]+(?:\.[0-9]+)*)/);
  const opening = md.match(/### Открытие[^\n]*\n((?:>.*\n?)+)/);
  if (!head || !version || !opening) {
    throw new Error(`${file}: не найден заголовок, версия или блок «Открытие»`);
  }
  const id = head[1];
  // Преподавателю отдаём карточку, кейс, формуляр, рубрику и режимы.
  // Близнец и история версий ему не нужны.
  const cut = md.search(/^## Часть E\./m);
  const dossier = (cut === -1 ? md : md.slice(0, cut)).trim();
  // Рубрика: строки таблицы «| № | Пункт | Вес |» из части C — единственный источник истины для оценки
  const cStart = md.search(/^## Часть C\./m);
  const cEnd = md.search(/^### Критические флаги/m);
  const rubric = [];
  if (cStart !== -1) {
    for (const line of md.slice(cStart, cEnd === -1 ? undefined : cEnd).split("\n")) {
      const row = line.match(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*(\d+)\s*\|\s*$/);
      if (row) rubric.push({ n: Number(row[1]), text: row[2].replace(/\*\*/g, ""), weight: Number(row[3]) });
    }
  }
  if (!rubric.length) throw new Error(`${file}: не найдена таблица рубрики`);
  cases[id] = {
    id,
    title: head[2].trim(),
    version: version[1],
    hash: createHash("sha256").update(md).digest("hex").slice(0, 16),
    source: file,
    opening: opening[1].replace(/^>\s?/gm, "").trim(),
    dossier,
    rubric,
  };
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
  outFile,
  `// Файл создаётся автоматически: scripts/build-cases.mjs. Вручную не править.\nexport const CASES = ${JSON.stringify(cases, null, 2)};\n`
);
console.log("cases:", Object.values(cases).map((c) => `${c.id}@v${c.version} (${c.hash}), пунктов рубрики: ${c.rubric.length}, сумма весов: ${c.rubric.reduce((a, r) => a + r.weight, 0)}`).join("; "));
