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
  cases[id] = {
    id,
    title: head[2].trim(),
    version: version[1],
    hash: createHash("sha256").update(md).digest("hex").slice(0, 16),
    source: file,
    opening: opening[1].replace(/^>\s?/gm, "").trim(),
    dossier,
  };
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
  outFile,
  `// Файл создаётся автоматически: scripts/build-cases.mjs. Вручную не править.\nexport const CASES = ${JSON.stringify(cases, null, 2)};\n`
);
console.log("cases:", Object.values(cases).map((c) => `${c.id}@v${c.version} (${c.hash})`).join(", "));
