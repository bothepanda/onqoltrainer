import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";

// ─── Case history (Vercel Blob via /api/history) ───────────────────────────
function getUserId(apiKey) {
  if (!apiKey) return null;
  let h = 5381;
  for (let i = 0; i < apiKey.length; i++) {
    h = ((h << 5) + h) ^ apiKey.charCodeAt(i);
  }
  return (h >>> 0).toString(36).padStart(8, "0");
}

async function apiFetchHistory(uid) {
  try {
    const r = await fetch(`/api/history?uid=${uid}`);
    const d = await r.json();
    return Array.isArray(d.history) ? d.history : [];
  } catch { return []; }
}

async function apiAddCase(uid, label) {
  try {
    const r = await fetch(`/api/history?uid=${uid}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    const d = await r.json();
    return Array.isArray(d.history) ? d.history : null;
  } catch { return null; }
}

async function apiClearHistory(uid) {
  try { await fetch(`/api/history?uid=${uid}`, { method: "DELETE" }); }
  catch {}
}

function extractCaseLabel(text) {
  const m = text.match(/[МЖмж]ужчина|[Жж]енщина/);
  const age = text.match(/(\d{2,3})\s*лет/);
  const complaint = text.match(/жалоб[аы][^.]{0,60}/i);
  if (m && age) {
    const who = m[0] + ", " + age[1] + " лет";
    const what = complaint ? ", " + complaint[0].slice(0, 50) : "";
    return (who + what).slice(0, 100);
  }
  return text.replace(/\n/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}
// ───────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `# System Prompt — Тренажёр клинических кейсов

## Хирургия · Казахстанский контекст · Русский язык

---

## РОЛЬ И ИДЕНТИЧНОСТЬ

Ты — клинический преподаватель-хирург. Ведёшь разбор хирургических кейсов с резидентами общей хирургии. Твой стиль — строгий, но поддерживающий. Ты не читаешь лекции — ты задаёшь вопросы, слушаешь, корректируешь. Думай как опытный attending, который ведёт разбор у постели больного или на конференции.

Ты работаешь в казахстанском клиническом контексте: государственные больницы, ограниченные ресурсы, доступность исследований и препаратов реальная, а не идеальная. Не предлагай то, чего нет в стандартной казахстанской клинике без явной оговорки.

Язык — русский. Медицинская терминология — русскоязычная, принятая в СНГ-системе (не транслитерация англоязычных терминов без необходимости). Если термин лучше звучит на английском (например, "damage control") — используй его с пояснением при первом упоминании.

---

## УПРАВЛЕНИЕ СЕССИЕЙ

У тебя нет памяти между разными чатами. Внутри одной сессии — отслеживай всё активно:

- Сколько кейсов прошли
- Уровень резидента по его ответам (обновляй оценку после каждого кейса)
- Что было пропущено или сделано неоптимально — чтобы вернуться в разборе
- Подсказки, которые были даны — учитывай при оценке уровня

В конце сессии (когда резидент пишет "конец кейса") — предложи резюме для сохранения.

---

## СТРУКТУРА КЕЙСА

Каждый кейс проходит через следующие этапы. Ты ведёшь по ним — но если резидент уходит вперёд или задаёт неожиданный вопрос, следуй за ним, не обрывай на середине. Гибкость важна.

### Этап 1 — Презентация

Представляй пациента кратко, как на приёмном покое:
- Пол, возраст
- Главная жалоба + время начала
- 1–2 ключевых анамнестических факта
- Витальные показатели (если критичны — сразу, если нет — по запросу)

Заканчивай вопросом: "С чего начнёшь?"

### Этап 2 — Сбор информации

Резидент запрашивает данные. Ты выдаёшь их последовательно — только то, что запрошено. Не подсказывай. Если резидент пропускает важное — не говори сразу. Запомни пропуск, вернёшься к нему в разборе.

Все числовые данные кейса устанавливаются в момент генерации кейса и не меняются. Если резидент запрашивает данные, которые ты ещё не выдавал — генерируй их один раз и фиксируй. Не пересматривай уже выданные цифры.

Доступные данные по запросу: детали анамнеза, физикальный осмотр, лабораторные анализы (ОАК, биохимия, коагулограмма, группа крови), инструментальные исследования (УЗИ, рентген, КТ, ФГДС), консультации специалистов.

Если резидент запрашивает исследование, недоступное или нецелесообразное — скажи об этом и объясни кратко.

### Этап 3 — Рабочий диагноз

Спроси: "Какой твой рабочий диагноз? Дифференциальный ряд?"

Выслушай. Не прерывай. После — скажи, что верно, что нет, что пропущено. Одним-двумя предложениями — без лекции.

### Этап 4 — Тактика

Спроси: "Что делаешь дальше? Какова тактика?"

Принимай ответы в любом порядке. Если резидент пропускает критический шаг — не подсказывай сразу, отметь про себя.

### Этап 5 — Поворот кейса (условный)

Добавляй поворот, если выполнены все три условия:
1. Все четыре этапа пройдены без запроса подсказок
2. Дифференциальный ряд содержал минимум два диагноза с обоснованием
3. Тактика была сформулирована с аргументацией, а не перечислена списком

Если условия выполнены — добавь изменение состояния: "Через 2 часа после операции давление упало до 80/50. Что думаешь?"

Если хотя бы одно условие не выполнено — переходи сразу к разбору.

### Этап 6 — Разбор

Структура:
A. Что было сделано правильно — конкретно, не формально
B. Что пропущено или сделано неоптимально — без осуждения, с клиническим reasoning
C. Ключевой обучающий момент — одна главная мысль
D. Дополнительное чтение — 2–3 источника строго из следующего списка официальных гайдлайнов: WSES (World Society of Emergency Surgery), ESCP (European Society of Coloproctology), ESSES (European Society for Surgical Endoscopy), EAES, ACS TQIP / ATLS, WHO Surgical Safety Checklist, ERAS Society guidelines, European Hernia Society (EHS), ESGE (эндоскопия). Указывай только реальные документы с годом публикации. Не генерируй несуществующие ссылки и не ссылайся на UpToDate — это платная база, не публичный гайдлайн.

---

## АДАПТАЦИЯ СЛОЖНОСТИ

Оцениваешь уровень по ответам, адаптируешь следующий кейс незаметно.

Слабые сигналы → упрощай: пропущены базовые шаги, дифдиагноз из 1 позиции, тактика без объяснения, запрашивал подсказку.

Сильные сигналы → усложняй: все этапы без подсказок, структурированный дифдиагноз, тактика с аргументацией, предвосхищает осложнения.

Уровни:
- Базовый: классическая презентация, один очевидный диагноз, фокус на последовательности
- Средний: атипичная презентация, конкурирующие диагнозы, один отвлекающий результат
- Продвинутый: коморбидный пациент, неполные данные, ресурсные ограничения

---

## ПРАВИЛА ПОВЕДЕНИЯ

Не читай лекции во время кейса. Разбор — после.
Не давай подсказки без запроса. Если резидент молчит — спроси: "Что думаешь? Что мешает принять решение?"
Если резидент ошибается — не исправляй сразу. Спроси: "Почему именно так?"
Если просит подсказку — дай наводящий вопрос, не ответ.
Если хочет остановить кейс — останови, краткий разбор, предложи продолжить позже.
Не придумывай данные постфактум.

---

## БАНК ТЕМАТИК (SCORE General Surgery Curriculum 2025–2026)

Тематику выбирают через интерфейс или случайно. Внутри темы варьируй возраст, пол, коморбидность, тяжесть. COMMON-темы требуют полного владения — диагностика, тактика, операция, осложнения. UNCOMMON — достаточно диагностики и начального ведения.

Экстренная хирургия: острый аппендицит (классический/атипичный/перфоративный/ретроцекальный), острый холецистит и холангит, желчнокаменная болезнь с осложнениями, прободная язва желудка и ДПК, острая кишечная непроходимость (спаечная/опухолевая/заворот сигмы), ущемлённая грыжа (паховая/бедренная/вентральная), ЖКК верхнее (язвенное/варикозное) и нижнее (дивертикулёз/опухоль/ангиодисплазия), острый панкреатит (лёгкий/тяжёлый/некротический), острый перитонит и абсцесс брюшной полости, острая мезентериальная ишемия, C. difficile-колит (включая фульминантный), ишемический колит.

Билиарная и гепатопанкреатическая хирургия: холедохолитиаз и механическая желтуха, ятрогенное повреждение желчных протоков, первичные и метастатические опухоли печени, гепатический абсцесс, рак поджелудочной железы (экзокринный/эндокринный), хронический панкреатит, кистозные опухоли поджелудочной железы.

Плановая и онкологическая хирургия: колоректальный рак (правые/левые отделы/прямая кишка), рак желудка, ГЭРБ и пищевод Барретта, рак пищевода, ГИСТ и нейроэндокринные опухоли ЖКТ, болезнь Крона и НЯК (плановые вмешательства), дивертикулярная болезнь, полипы и полипозные синдромы, аноректальные заболевания (рак прямой кишки/анальный рак/свищи/геморрой/трещина/выпадение), грыжи (паховая/бедренная/вентральная/диафрагмальная).

Молочная железа и эндокринная хирургия: рак молочной железы (инвазивный/DCIS/воспалительный/наследственный), образование молочной железы, узел и рак щитовидной железы, тиреоидит, гиперпаратиреоз, феохромоцитома, инциденталома надпочечника, синдром Кушинга, первичный гиперальдостеронизм.

Послеоперационные осложнения и критические состояния: несостоятельность анастомоза, послеоперационное кровотечение, инфекция раны/SSI/некротизирующий фасциит, сепсис и септический шок, ТГВ/ТЭЛА (профилактика и лечение), ARDS и дыхательная недостаточность, синдром абдоминальной компрессии, острая почечная недостаточность, острая печёночная недостаточность, нарушения водно-электролитного баланса (K/Na/Ca/Mg), гиповолемический шок, нутриционная поддержка послеоперационного пациента.

Травма: первичный осмотр по ATLS (ABCDE/FAST), повреждение селезёнки (оперативное/консервативное), травматическое повреждение печени, damage control surgery, торакальная травма (гемопневмоторакс/ушиб лёгкого/нестабильная грудная клетка), повреждения полых органов ЖКТ, ожоги (первичная оценка/инфузия по Паркленду/эсхаротомия), тяжёлая травма таза и забрюшинная гематома.

Сосудистая и смежная хирургия: острая ишемия конечности, компартмент-синдром и фасциотомия, диабетическая стопа и инфекция, заболевания периферических артерий, ТГВ и хроническая венозная недостаточность.

UNCOMMON-темы (диагностика + начальное ведение — без требования операционного плана): десмоиды и фиброматозы, перитонеальные неоплазмы, первичный склерозирующий холангит, рак желчного пузыря, хронический панкреатит, кистозные опухоли поджелудочной железы, короткий кишечник, энтеральные инфекции, фекальная инконтиненция, транс-анальная резекция, АПР и эвисцерация таза, аортальные аневризмы, острое аортальное расслоение, тромбоэмболия верхней брыжеечной артерии, злокачественные опухоли лёгкого и средостения, медиастинит, врождённые пороки у детей (атрезия пищевода, болезнь Гиршспрунга, гастрошизис), трансплантация органов (показания, иммуносупрессия), феохромоцитома периоперационно, МЭН-синдромы, рак паращитовидных желёз, лимфедема, саркома мягких тканей.

Если тренер даёт UNCOMMON-кейс — явно обозначить это в начале: «Редкая патология. Цель: диагностика и первый шаг в ведении». Не требовать операционного плана и не оценивать как COMMON.

Global Surgery (актуально для казахстанского контекста): тифозная перфорация кишечника, внелёгочный и кишечный туберкулёз, столбняк, ожоговые контрактуры, тропические инфекции с хирургическими осложнениями. Эти кейсы маркировать: «Актуально в условиях ограниченных ресурсов».

---

## ТЕХНИЧЕСКИЕ ПАРАМЕТРЫ

- Язык: русский (терминология СНГ)
- Длина ответов во время кейса: 1–4 предложения
- Длина разбора: средняя, структурированная, без воды
- Тон: профессиональный, прямой, без похвалы за базовые вещи
- Никаких смайлов, никакого "отличный вопрос"`;

const CATEGORIES = [
  { id: "emergency", label: "Экстренная хирургия", prompt: "Дай кейс по экстренной хирургии (острый живот, ЖКК, перитонит, непроходимость, панкреатит)." },
  { id: "hpb_biliary", label: "Билиарная / ГПХ", prompt: "Дай кейс по билиарной или гепатопанкреатической хирургии (желчнокаменная болезнь, холангит, опухоль печени или поджелудочной, панкреатит)." },
  { id: "planned", label: "Плановая / онкология", prompt: "Дай кейс по плановой или онкологической хирургии (колоректальный рак, рак желудка, грыжа, ВЗК, аноректальная патология, молочная железа, щитовидная железа)." },
  { id: "critical", label: "Послеоп / Критические", prompt: "Дай кейс по послеоперационным осложнениям или критическим состояниям (несостоятельность, сепсис, ТЭЛА, ARDS, электролитные нарушения, шок)." },
  { id: "trauma", label: "Травма", prompt: "Дай кейс по хирургической травме (ATLS, повреждение паренхиматозных органов, damage control, торакальная травма, ожоги)." },
  { id: "uncommon", label: "Редкая патология", prompt: "Дай кейс по UNCOMMON-теме из куррикулума SCORE. В начале кейса явно отметь: это редкая патология, цель — диагностика и начальное ведение, операционный план не требуется." },
  { id: "global", label: "Глобальная хирургия", prompt: "Дай кейс по теме Global Surgery, актуальной для казахстанского контекста: тифозная перфорация, туберкулёз с хирургическими осложнениями, столбняк, ожоговые контрактуры. Отметь в начале: кейс в условиях ограниченных ресурсов." },
  { id: "random", label: "Случайный", prompt: "Выбери кейс случайно из любой категории куррикулума SCORE General Surgery, включая UNCOMMON и Global Surgery." },
];

function TypingIndicator() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "5px", padding: "12px 16px" }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "#16697A",
            display: "inline-block",
            animation: "pulse 1.2s ease-in-out infinite",
            animationDelay: `${i * 0.2}s`,
            opacity: 0.5,
          }}
        />
      ))}
    </div>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="M21 2l-9.6 9.6M15.5 7.5l3 3" />
    </svg>
  );
}

export default function ONQOLTrainer() {
  const [phase, setPhase] = useState("start"); // start | session | summary
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [summary, setSummary] = useState("");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("onqol_api_key") || "");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [error, setError] = useState("");
  const [hoveredCat, setHoveredCat] = useState(null);
  const [caseHistory, setCaseHistory] = useState([]);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
    }
  }, [input]);

  useEffect(() => {
    if (!apiKey) return;
    const uid = getUserId(apiKey);
    apiFetchHistory(uid).then(setCaseHistory);
  }, [apiKey]);

  async function callClaude(history) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: history,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const msg = errData.error?.message
        || (errData.error ? JSON.stringify(errData.error) : null)
        || JSON.stringify(errData)
        || `Ошибка API: ${response.status}`;
      throw new Error(msg);
    }

    const data = await response.json();
    return data.content?.map((b) => b.text || "").join("") || "";
  }

  function saveApiKey() {
    const key = apiKeyDraft.trim();
    if (!key) return;
    localStorage.setItem("onqol_api_key", key);
    setApiKey(key);
    setApiKeyDraft("");
    setShowKeyInput(false);
    setError("");
  }

  function clearApiKey() {
    localStorage.removeItem("onqol_api_key");
    setApiKey("");
    setShowKeyInput(true);
  }

  async function startSession(category) {
    if (!apiKey) {
      setShowKeyInput(true);
      return;
    }
    setError("");
    setPhase("session");
    setLoading(true);

    try {
      const uid = getUserId(apiKey);
      const historyNote = caseHistory.length > 0
        ? `\n\nУже разобранные кейсы в предыдущих сессиях — обязательно избегай повторения этих нозологий и клинических сценариев: ${caseHistory.join(" | ")}.`
        : "";
      const initMessages = [{ role: "user", content: category.prompt + historyNote }];
      const firstCase = await callClaude(initMessages);

      // Сохраняем кейс в историю (API + state)
      const label = extractCaseLabel(firstCase);
      const updated = await apiAddCase(uid, label);
      if (updated) setCaseHistory(updated);

      setMessages([{ role: "assistant", content: firstCase }]);
      window.__onqolHistory = [...initMessages, { role: "assistant", content: firstCase }];
    } catch (err) {
      setError(err.message);
      setPhase("start");
    } finally {
      setLoading(false);
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setError("");

    const userMsg = { role: "user", content: text };
    const newHistory = [...(window.__onqolHistory || []), userMsg];
    window.__onqolHistory = newHistory;

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const reply = await callClaude(newHistory);
      const assistantMsg = { role: "assistant", content: reply };
      window.__onqolHistory = [...newHistory, assistantMsg];
      setMessages((prev) => [...prev, assistantMsg]);

      if (text.trim().toLowerCase() === "конец кейса") {
        setTimeout(() => generateSummary([...window.__onqolHistory, assistantMsg]), 800);
      }
    } catch (err) {
      setError(err.message);
      setMessages((prev) => prev.filter((m) => m !== userMsg));
      setInput(text);
      window.__onqolHistory = newHistory.slice(0, -1);
    } finally {
      setLoading(false);
    }
  }

  async function generateSummary(history) {
    const summaryHistory = [
      ...history,
      {
        role: "user",
        content:
          "Сессия завершена. Дай краткое резюме: сколько кейсов прошли, что получилось хорошо, над чем работать. Формат — чистый текст без markdown, чтобы можно было скопировать в заметки.",
      },
    ];
    try {
      const text = await callClaude(summaryHistory);
      setSummary(text);
      setPhase("summary");
    } catch (err) {
      setError(err.message);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function copySummary() {
    navigator.clipboard.writeText(summary).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function restart() {
    setPhase("start");
    setMessages([]);
    setInput("");
    setSummary("");
    setError("");
    setShowKeyInput(false);
    window.__onqolHistory = [];
  }

  const C = {
    bg: "#f2f7f8",
    surface: "#ffffff",
    header: "#ffffff",
    accent: "#16697A",
    accentLight: "#eaf4f6",
    accentMuted: "#a8cfd5",
    text: "#0d2124",
    textMid: "#3a7a84",
    textSub: "#8ab8be",
    border: "rgba(22,105,122,0.15)",
    borderMid: "rgba(22,105,122,0.25)",
    userMsg: "#16697A",
    userText: "#ffffff",
    error: "#c0392b",
    errorBg: "#fdf0ef",
  };

  const styles = {
    root: {
      fontFamily: "'IBM Plex Mono', 'Courier New', monospace",
      background: C.bg,
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      color: C.text,
    },
    header: {
      borderBottom: `1px solid ${C.border}`,
      padding: "16px 24px",
      display: "flex",
      alignItems: "center",
      gap: "12px",
      background: C.header,
      boxShadow: "0 1px 3px rgba(22,105,122,0.06)",
    },
    logo: {
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: "13px",
      fontWeight: 700,
      letterSpacing: "0.15em",
      color: C.accent,
      textTransform: "uppercase",
    },
    logoSep: {
      width: 1,
      height: 18,
      background: C.borderMid,
    },
    logoSub: {
      fontSize: "12px",
      color: C.textMid,
      letterSpacing: "0.05em",
    },
    // START SCREEN
    startWrap: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "40px 24px",
      gap: "36px",
    },
    startTitle: {
      textAlign: "center",
    },
    startH1: {
      fontSize: "28px",
      fontWeight: 700,
      color: C.accent,
      letterSpacing: "0.05em",
      margin: 0,
      lineHeight: 1.2,
    },
    startSub: {
      fontSize: "13px",
      color: C.textMid,
      letterSpacing: "0.12em",
      marginTop: "8px",
      textTransform: "uppercase",
    },
    divider: {
      width: "40px",
      height: "2px",
      background: C.accent,
      margin: "16px auto 0",
      borderRadius: "1px",
    },
    categoryGrid: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "12px",
      width: "100%",
      maxWidth: "420px",
    },
    catBtn: (hovered) => ({
      background: hovered ? C.accent : C.surface,
      border: `1px solid ${hovered ? C.accent : C.borderMid}`,
      borderRadius: "4px",
      color: hovered ? "#ffffff" : C.accent,
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: "12px",
      letterSpacing: "0.08em",
      padding: "18px 12px",
      cursor: "pointer",
      transition: "all 0.15s ease",
      textAlign: "center",
      lineHeight: 1.4,
      boxShadow: hovered ? "0 2px 8px rgba(22,105,122,0.2)" : "0 1px 3px rgba(22,105,122,0.06)",
    }),
    hint: {
      fontSize: "12px",
      color: C.textSub,
      letterSpacing: "0.05em",
      textAlign: "center",
    },
    // API KEY
    keyCard: {
      background: C.surface,
      border: `1px solid ${C.borderMid}`,
      borderRadius: "6px",
      padding: "20px 24px",
      maxWidth: "420px",
      width: "100%",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
    },
    keyLabel: {
      fontSize: "12px",
      color: C.textMid,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    },
    keyInputRow: {
      display: "flex",
      gap: "8px",
    },
    keyInput: {
      flex: 1,
      background: C.bg,
      border: `1px solid ${C.border}`,
      borderRadius: "4px",
      color: C.text,
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: "13px",
      padding: "10px 12px",
      outline: "none",
      letterSpacing: "0.05em",
    },
    keyBtn: {
      background: C.accent,
      border: "none",
      borderRadius: "4px",
      color: "#ffffff",
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: "12px",
      fontWeight: 700,
      letterSpacing: "0.08em",
      padding: "10px 16px",
      cursor: "pointer",
      whiteSpace: "nowrap",
    },
    keyHint: {
      fontSize: "12px",
      color: C.textSub,
      lineHeight: 1.6,
    },
    keyStatus: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      fontSize: "12px",
      color: C.textMid,
    },
    keyClear: {
      fontSize: "12px",
      color: C.textSub,
      cursor: "pointer",
      background: "none",
      border: "none",
      fontFamily: "'IBM Plex Mono', monospace",
      letterSpacing: "0.05em",
      padding: 0,
      textDecoration: "underline",
    },
    // ERROR
    errorBox: {
      background: C.errorBg,
      border: `1px solid rgba(192,57,43,0.2)`,
      borderRadius: "4px",
      padding: "10px 14px",
      fontSize: "12px",
      color: C.error,
      maxWidth: "420px",
      width: "100%",
      lineHeight: 1.5,
    },
    // CHAT
    chatWrap: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    },
    messages: {
      flex: 1,
      overflowY: "auto",
      padding: "24px 20px",
      display: "flex",
      flexDirection: "column",
      gap: "14px",
    },
    msgAssistant: {
      alignSelf: "flex-start",
      maxWidth: "82%",
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: "2px 12px 12px 12px",
      padding: "14px 18px",
      fontSize: "15px",
      lineHeight: 1.75,
      color: C.text,
      boxShadow: "0 1px 4px rgba(22,105,122,0.06)",
    },
    msgUser: {
      alignSelf: "flex-end",
      maxWidth: "72%",
      background: C.userMsg,
      borderRadius: "12px 2px 12px 12px",
      padding: "10px 16px",
      fontSize: "15px",
      lineHeight: 1.6,
      color: C.userText,
      fontWeight: 500,
    },
    chatErrorRow: {
      padding: "6px 20px",
      background: C.errorBg,
      borderTop: `1px solid rgba(192,57,43,0.1)`,
      fontSize: "12px",
      color: C.error,
    },
    inputRow: {
      borderTop: `1px solid ${C.border}`,
      padding: "12px 16px",
      display: "flex",
      gap: "10px",
      alignItems: "flex-end",
      background: C.surface,
    },
    textarea: {
      flex: 1,
      background: C.bg,
      border: `1px solid ${C.border}`,
      borderRadius: "4px",
      color: C.text,
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: "13px",
      padding: "10px 12px",
      resize: "none",
      outline: "none",
      lineHeight: 1.5,
      minHeight: "42px",
      maxHeight: "160px",
    },
    sendBtn: (active) => ({
      background: active ? C.accent : C.accentLight,
      border: "none",
      borderRadius: "4px",
      color: active ? "#ffffff" : C.accentMuted,
      cursor: active ? "pointer" : "default",
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: "13px",
      fontWeight: 700,
      padding: "10px 16px",
      transition: "all 0.15s",
      alignSelf: "flex-end",
      height: "42px",
    }),
    hintRow: {
      padding: "4px 16px 8px",
      fontSize: "12px",
      color: C.textSub,
      letterSpacing: "0.05em",
      background: C.surface,
    },
    // SUMMARY
    summaryWrap: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "40px 24px",
      gap: "24px",
    },
    summaryCard: {
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: "6px",
      padding: "24px",
      maxWidth: "560px",
      width: "100%",
      boxShadow: "0 2px 8px rgba(22,105,122,0.06)",
    },
    summaryTitle: {
      fontSize: "12px",
      color: C.accent,
      letterSpacing: "0.15em",
      textTransform: "uppercase",
      marginBottom: "16px",
    },
    summaryText: {
      fontSize: "13px",
      lineHeight: 1.8,
      color: C.text,
      whiteSpace: "pre-wrap",
    },
    summaryActions: {
      display: "flex",
      gap: "12px",
      maxWidth: "560px",
      width: "100%",
    },
    actionBtn: (primary) => ({
      flex: 1,
      background: primary ? C.accent : C.surface,
      border: `1px solid ${primary ? C.accent : C.borderMid}`,
      borderRadius: "4px",
      color: primary ? "#ffffff" : C.accent,
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: "12px",
      fontWeight: 700,
      letterSpacing: "0.08em",
      padding: "12px",
      cursor: "pointer",
      transition: "all 0.15s",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "6px",
    }),
  };

  return (
    <div style={styles.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap');
        @keyframes pulse {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.3; }
          40% { transform: scale(1); opacity: 1; }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(22,105,122,0.2); border-radius: 2px; }
        textarea::placeholder { color: #a8cfd5; }
        input::placeholder { color: #a8cfd5; }
        input:focus { border-color: rgba(22,105,122,0.4) !important; }
        .msg-assistant > * > p:last-child { margin-bottom: 0 !important; }
      `}</style>

      {/* HEADER */}
      <div style={styles.header}>
        <span style={styles.logo}>ON QOL</span>
        <div style={styles.logoSep} />
        <span style={styles.logoSub}>Тренажёр клинических кейсов</span>
        {apiKey && phase === "start" && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "16px" }}>
            {caseHistory.length > 0 && (
              <button
                onClick={async () => {
                  await apiClearHistory(getUserId(apiKey));
                  setCaseHistory([]);
                }}
                title="Сбросить историю кейсов"
                style={{
                  background: "none",
                  border: `1px solid rgba(22,105,122,0.2)`,
                  borderRadius: "4px",
                  color: C.textMid,
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "12px",
                  cursor: "pointer",
                  letterSpacing: "0.05em",
                  padding: "4px 10px",
                }}
              >
                {caseHistory.length} кейс{caseHistory.length === 1 ? "" : caseHistory.length < 5 ? "а" : "ов"} · сбросить
              </button>
            )}
            <button
              onClick={clearApiKey}
              style={{
                background: "none",
                border: "none",
                color: C.textSub,
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: "12px",
                cursor: "pointer",
                letterSpacing: "0.05em",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <KeyIcon /> API ключ
            </button>
          </div>
        )}
      </div>

      {/* START */}
      {phase === "start" && (
        <div style={styles.startWrap}>
          <div style={styles.startTitle}>
            <h1 style={styles.startH1}>Выберите тематику</h1>
            <p style={styles.startSub}>Общая хирургия · Казахстанский контекст</p>
            <div style={styles.divider} />
          </div>

          {/* API KEY SETUP */}
          {(!apiKey || showKeyInput) && (
            <div style={styles.keyCard}>
              <div style={styles.keyLabel}>Anthropic API ключ</div>
              <div style={styles.keyInputRow}>
                <input
                  type="password"
                  style={styles.keyInput}
                  value={apiKeyDraft}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveApiKey()}
                  placeholder="sk-ant-..."
                />
                <button style={styles.keyBtn} onClick={saveApiKey}>
                  Сохранить
                </button>
              </div>
              <p style={styles.keyHint}>
                Ключ сохраняется в localStorage браузера и не передаётся никуда, кроме Anthropic API.
              </p>
            </div>
          )}

          {apiKey && !showKeyInput && (
            <>
              {error && <div style={styles.errorBox}>{error}</div>}
              <div style={styles.categoryGrid}>
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    style={styles.catBtn(hoveredCat === cat.id)}
                    onMouseEnter={() => setHoveredCat(cat.id)}
                    onMouseLeave={() => setHoveredCat(null)}
                    onClick={() => startSession(cat)}
                    disabled={loading}
                  >
                    {loading ? "..." : cat.label}
                  </button>
                ))}
              </div>
            </>
          )}

          <p style={styles.hint}>Enter — отправить · Shift+Enter — новая строка</p>
        </div>
      )}

      {/* CHAT */}
      {phase === "session" && (
        <div style={styles.chatWrap}>
          <div style={styles.messages}>
            {messages.map((msg, i) => (
              <div
                key={i}
                className={msg.role === "assistant" ? "msg-assistant" : undefined}
                style={msg.role === "assistant" ? styles.msgAssistant : styles.msgUser}
              >
                {msg.role === "assistant" ? (
                  <ReactMarkdown
                    components={{
                      p: ({ children }) => <p style={{ margin: "0 0 10px 0" }}>{children}</p>,
                      strong: ({ children }) => <strong style={{ color: C.accent, fontWeight: 700 }}>{children}</strong>,
                      ol: ({ children }) => <ol style={{ margin: "8px 0", paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>{children}</ol>,
                      ul: ({ children }) => <ul style={{ margin: "8px 0", paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" }}>{children}</ul>,
                      li: ({ children }) => <li style={{ lineHeight: 1.6 }}>{children}</li>,
                      h1: ({ children }) => <h1 style={{ fontSize: "16px", fontWeight: 700, color: C.accent, margin: "12px 0 6px" }}>{children}</h1>,
                      h2: ({ children }) => <h2 style={{ fontSize: "15px", fontWeight: 700, color: C.accent, margin: "10px 0 4px" }}>{children}</h2>,
                      h3: ({ children }) => <h3 style={{ fontSize: "14px", fontWeight: 700, color: C.textMid, margin: "8px 0 4px" }}>{children}</h3>,
                      hr: () => <hr style={{ border: "none", borderTop: `1px solid ${C.border}`, margin: "12px 0" }} />,
                      code: ({ children }) => <code style={{ background: C.accentLight, padding: "1px 5px", borderRadius: "3px", fontSize: "13px" }}>{children}</code>,
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                ) : (
                  msg.content
                )}
              </div>
            ))}
            {loading && (
              <div style={styles.msgAssistant}>
                <TypingIndicator />
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          {error && <div style={styles.chatErrorRow}>{error}</div>}
          <div style={styles.hintRow}>
            чтобы завершить сессию и получить резюме — напишите «конец кейса»
          </div>
          <div style={styles.inputRow}>
            <textarea
              ref={textareaRef}
              style={styles.textarea}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ваш ответ..."
              rows={1}
              disabled={loading}
            />
            <button
              style={styles.sendBtn(input.trim().length > 0 && !loading)}
              onClick={send}
            >
              →
            </button>
          </div>
        </div>
      )}

      {/* SUMMARY */}
      {phase === "summary" && (
        <div style={styles.summaryWrap}>
          <div style={styles.summaryCard}>
            <div style={styles.summaryTitle}>Резюме сессии</div>
            <div style={styles.summaryText}>{summary}</div>
          </div>
          <div style={styles.summaryActions}>
            <button style={styles.actionBtn(false)} onClick={copySummary}>
              <CopyIcon />
              {copied ? "Скопировано" : "Скопировать"}
            </button>
            <button style={styles.actionBtn(true)} onClick={restart}>
              Новая сессия →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
