// Расписание учебных пятниц: что резидент проходит в каждую дату.
// kind "new"    — первое прохождение (обучающий режим, с подсказками)
// kind "retest" — повтор того же кейса без подсказок
// Кейс должен существовать в cases/*.md. Новые пятницы добавляются сюда.
export const PLAN = [
  { date: "2026-09-25", items: [{ case: "fluids-01", kind: "new" }] },
  { date: "2026-10-02", items: [{ case: "fluids-01", kind: "retest" }] },
];

export const MODE_OF_KIND = { new: "tutored", retest: "retest" };

// Астана / Алматы: UTC+5
export function todayAlmaty(now = Date.now()) {
  return new Date(now + 5 * 3600 * 1000).toISOString().slice(0, 10);
}
