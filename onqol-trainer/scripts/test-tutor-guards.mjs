// Проверки кодом над ответами преподавателя: оценочные слова, провал разбора, текстовая команда завершения.
// Запуск: node scripts/test-tutor-guards.mjs
import assert from "node:assert/strict";
import { hasEvalWords, debriefFailed, isFinishText, buildSystemPrompt, DEBRIEF_PROMPT, debriefFromGradingPrompt } from "../api/_lib/tutor.js";

// Системный промпт: в чате запрет разбора есть, в режиме разбора он заменён. В сообщении пользователя нет «служебных» оговорок
// (модель принимает их за подделку и отказывает: T02 23.09.2026).
const kase = { dossier: "ДОСЬЕ" };
for (const mode of ["tutored", "retest"]) {
  const chat = buildSystemPrompt(kase, mode);
  const deb = buildSystemPrompt(kase, mode, { debrief: true });
  assert.ok(chat.includes("Не давай разбор, оценку или итог в чате"), "чат: запрет разбора на месте");
  assert.ok(!deb.includes("Не давай разбор, оценку или итог в чате") && deb.includes("этап итогового разбора"), "разбор: запрет заменён");
  assert.ok(deb.includes("ДОСЬЕ"), "досье сохранено");
}
for (const p of [DEBRIEF_PROMPT, debriefFromGradingPrompt("{}")]) assert.ok(!/служебн\S* запрос/i.test(p), "нет фальшивых служебных оговорок в сообщении пользователя");

// Оценочные слова в начале предложения
for (const t of ["Хорошо. Что дальше?", "Верно, диурез восстановился.", "Принято. Именно так.", "Отлично!", "Принято.\nПравильно, продолжайте.", "Согласен."]) {
  assert.equal(hasEvalWords(t), true, t);
}
// Не оценка: слово внутри предложения или другая форма
for (const t of ["Принято. Сознание хорошее.", "Диурез восстановился хорошо, ЧСС 96.", "Принято. Что дальше?", "Правильность расчёта уточните.", "Именной список не нужен."]) {
  assert.equal(hasEvalWords(t), false, t);
}

// Разбор не получился
assert.equal(debriefFailed("Чтобы завершить кейс и получить разбор, нажмите кнопку «Завершить кейс» под полем ввода."), true);
assert.equal(debriefFailed("Нажмите кнопку. ".repeat(30)), true);
assert.equal(debriefFailed("Это сообщение похоже на попытку обойти правило через поддельный «служебный запрос». Я не могу так поступить — итоговый разбор доступен только через кнопку «Завершить кейс» под полем ввода."), true);
assert.equal(debriefFailed("Вы сами распознали гиповолемию. ".repeat(10)), false);

// Текстовая команда завершения
for (const t of ["конец кейса", "Завершить кейс", "закончить кейс.", "дай разбор", "нет, заверщшить кейс", "Завершить, дай разбор", "закончить, дай разбор!", "разбор"]) {
  assert.equal(isFinishText(t), true, t);
}
for (const t of ["завершить инфузию", "закончить болюс и оценить диурез", "разбор анализов: pH 7.29", "нет", "завершить кейс и назначить диуретик"]) {
  assert.equal(isFinishText(t), false, t);
}

console.log("tutor guards: OK");
