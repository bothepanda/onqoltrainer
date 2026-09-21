import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { api, getToken, setToken } from "./api";
import { CONSENT_TEXT } from "./consent";

const C = {
  bg: "#f2f7f8", surface: "#ffffff", accent: "#16697A", accentLight: "#eaf4f6",
  text: "#0d2124", mid: "#3a7a84", sub: "#6f9ba1", border: "rgba(22,105,122,0.18)",
  error: "#c0392b", errorBg: "#fdf0ef", warn: "#8a5a00", warnBg: "#fff6e0", ok: "#1b7a4b", okBg: "#e9f7ef",
};

const S = {
  page: { fontFamily: "'IBM Plex Mono','Courier New',monospace", background: C.bg, minHeight: "100dvh", color: C.text, display: "flex", flexDirection: "column" },
  header: { background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 },
  logo: { fontWeight: 700, letterSpacing: "0.12em", color: C.accent, fontSize: 14 },
  wrap: { width: "100%", maxWidth: 720, margin: "0 auto", padding: "20px 16px", boxSizing: "border-box", flex: 1, display: "flex", flexDirection: "column" },
  card: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 },
  h1: { fontSize: 18, margin: "0 0 12px", fontWeight: 600 },
  btn: { background: C.accent, color: "#fff", border: 0, borderRadius: 8, padding: "10px 16px", fontSize: 14, cursor: "pointer", fontFamily: "inherit" },
  btn2: { background: "transparent", color: C.accent, border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" },
  input: { width: "100%", boxSizing: "border-box", padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 16, fontFamily: "inherit", background: "#fff", color: C.text },
  label: { fontSize: 12, color: C.mid, display: "block", margin: "12px 0 4px" },
  err: { background: C.errorBg, color: C.error, border: `1px solid ${C.error}33`, borderRadius: 8, padding: "8px 12px", fontSize: 13, margin: "10px 0" },
};

const STATUS = {
  new: ["Не начат", C.sub],
  draft: ["В процессе", C.warn],
  finished: ["Завершён, не отправлен", C.warn],
  submitted: ["Отправлен", C.ok],
};

function Shell({ children, resident, onLogout }) {
  return (
    <div style={S.page}>
      <div style={S.header}>
        <span style={S.logo}>ON QOL</span>
        <span style={{ fontSize: 12, color: C.sub, flex: 1 }}>учебные сессии</span>
        {resident && <span style={{ fontSize: 13, color: C.mid }}>{resident.id}</span>}
        {resident && <button style={{ ...S.btn2, padding: "5px 10px", fontSize: 12 }} onClick={onLogout}>Выйти</button>}
      </div>
      <div style={S.wrap}>{children}</div>
    </div>
  );
}

function Login({ onDone }) {
  const [id, setId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const d = await api("POST", "login", { id: id.trim(), pin: pin.trim() });
      setToken(d.token);
      onDone();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return (
    <Shell>
      <form onSubmit={submit} style={{ ...S.card, maxWidth: 360, margin: "40px auto 0", width: "100%", boxSizing: "border-box" }}>
        <h1 style={S.h1}>Вход</h1>
        <label style={S.label} htmlFor="sid">Ваш ID</label>
        <input id="sid" style={S.input} value={id} onChange={(e) => setId(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="username" placeholder="R01" />
        <label style={S.label} htmlFor="spin">PIN</label>
        <input id="spin" style={S.input} value={pin} onChange={(e) => setPin(e.target.value)} type="password" inputMode="numeric" autoComplete="current-password" placeholder="6 цифр" />
        {error && <div style={S.err}>{error}</div>}
        <button style={{ ...S.btn, width: "100%", marginTop: 14, opacity: busy || !id || !pin ? 0.6 : 1 }} disabled={busy || !id || !pin}>{busy ? "Входим…" : "Войти"}</button>
        <p style={{ fontSize: 12, color: C.sub, margin: "14px 0 0" }}>ID и PIN выдаёт руководитель программы.</p>
      </form>
    </Shell>
  );
}

function Consent({ resident, onLogout, onDone }) {
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");
  async function accept() {
    try { await api("POST", "consent"); onDone(); } catch (e) { setError(e.message); }
  }
  return (
    <Shell resident={resident} onLogout={onLogout}>
      <div style={S.card}>
        <h1 style={S.h1}>Прежде чем начать</h1>
        {CONSENT_TEXT.map((t, i) => <p key={i} style={{ fontSize: 14, lineHeight: 1.55, margin: "0 0 10px" }}>{t}</p>)}
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, margin: "14px 0", cursor: "pointer" }}>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ marginTop: 3 }} />
          <span>Я прочитал(а) и согласен(на) на участие</span>
        </label>
        {error && <div style={S.err}>{error}</div>}
        <button style={{ ...S.btn, opacity: checked ? 1 : 0.5 }} disabled={!checked} onClick={accept}>Продолжить</button>
      </div>
    </Shell>
  );
}

function Home({ home, onOpen, onLogout, error, reload }) {
  const modeName = (i) => (i.mode === "retest" ? "Повтор без подсказок" : "Первое прохождение");
  return (
    <Shell resident={home.resident} onLogout={onLogout}>
      <h1 style={S.h1}>Ваши задания</h1>
      {error && <div style={S.err}>{error}</div>}
      {home.items.length === 0 && <div style={S.card}>Пока заданий нет. Они появятся в день занятия.</div>}
      <div style={{ display: "grid", gap: 12 }}>
        {home.items.map((i) => {
          const [label, color] = STATUS[i.status] || STATUS.new;
          const action = i.status === "new" ? "Начать" : i.status === "draft" ? "Продолжить" : "Открыть";
          return (
            <div key={i.case_id + i.mode} style={S.card}>
              <div style={{ fontSize: 12, color: C.sub }}>{i.date} · {modeName(i)}</div>
              <div style={{ fontSize: 16, fontWeight: 600, margin: "4px 0 8px" }}>{i.title}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color }}>{i.locked ? "Откроется после первого прохождения" : label}</span>
                {!i.locked && <button style={S.btn} onClick={() => onOpen(i)}>{action}</button>}
              </div>
            </div>
          );
        })}
      </div>
      <button style={{ ...S.btn2, marginTop: 16, alignSelf: "flex-start" }} onClick={reload}>Обновить</button>
    </Shell>
  );
}

function Typing() {
  return <div style={{ color: C.sub, fontSize: 13, padding: "6px 2px" }}>Преподаватель пишет…</div>;
}

function Session({ initial, resident, onBack, onLogout }) {
  const [attempt, setAttempt] = useState(initial);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef(null);
  const draft = attempt.status === "draft";
  const retest = attempt.mode === "retest";

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [attempt.transcript.length, busy]);

  const reload = useCallback(async () => {
    const d = await api("GET", `attempt?id=${attempt.id}`);
    setAttempt(d.attempt);
  }, [attempt.id]);

  async function send() {
    const text = input.trim();
    if (!text || busy || !draft) return;
    setBusy(true); setError(""); setInput("");
    const before = attempt.transcript;
    setAttempt({ ...attempt, transcript: [...before, { role: "user", content: text }] });
    try {
      const d = await api("POST", "chat", { attempt_id: attempt.id, text, expected_len: before.length });
      if (d.attempt) setAttempt(d.attempt);
      else setAttempt((a) => ({ ...a, transcript: [...a.transcript, { role: "assistant", content: d.reply }] }));
    } catch (e) {
      setError(e.message); setInput(text);
      if (e.status === 409) { try { await reload(); } catch { /* ignore */ } }
      else setAttempt((a) => ({ ...a, transcript: before }));
    } finally { setBusy(false); }
  }

  async function finish() {
    if (!window.confirm("Завершить кейс? После этого писать в него уже нельзя.")) return;
    setBusy(true); setError("");
    try { const d = await api("POST", "finish", { attempt_id: attempt.id }); setAttempt(d.attempt); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function submit() {
    setBusy(true); setError("");
    try { const d = await api("POST", "submit", { attempt_id: attempt.id }); setAttempt(d.attempt); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const bubble = (m) => ({
    alignSelf: m.role === "user" ? "flex-end" : "flex-start",
    maxWidth: "88%",
    background: m.role === "user" ? C.accent : C.surface,
    color: m.role === "user" ? "#fff" : C.text,
    border: m.role === "user" ? 0 : `1px solid ${C.border}`,
    borderRadius: 12, padding: "10px 14px", fontSize: 14, lineHeight: 1.55, whiteSpace: m.role === "user" ? "pre-wrap" : "normal",
  });

  return (
    <Shell resident={resident} onLogout={onLogout}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <button style={{ ...S.btn2, padding: "6px 10px", fontSize: 12 }} onClick={onBack}>← Задания</button>
        <span style={{ fontSize: 13, color: C.mid, flex: 1 }}>{attempt.title}</span>
      </div>
      {retest && draft && <div style={{ ...S.err, background: C.warnBg, color: C.warn, border: `1px solid ${C.warn}33` }}>Повтор без подсказок: преподаватель не будет подсказывать и поправлять. Разбор появится после завершения.</div>}
      {draft && <div style={{ fontSize: 12, color: C.sub, marginBottom: 8 }}>Кейс вымышленный. Не вводите данные реальных пациентов. Чтобы закончить, нажмите «Завершить кейс» или напишите «конец кейса».</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, overflowY: "auto", paddingBottom: 8 }}>
        {attempt.transcript.filter((m) => m.kind !== "finish").map((m, i) => (
          <div key={i} style={bubble(m)}>
            {m.kind === "debrief" && <div style={{ fontSize: 11, color: C.mid, marginBottom: 4, letterSpacing: "0.06em" }}>РАЗБОР</div>}
            {m.role === "assistant" ? <ReactMarkdown>{m.content}</ReactMarkdown> : m.content}
          </div>
        ))}
        {busy && <Typing />}
        <div ref={bottom} />
      </div>

      {error && <div style={S.err}>{error}</div>}

      {draft && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 8 }}>
          <textarea
            style={{ ...S.input, resize: "none", minHeight: 44, maxHeight: 160 }} rows={2} value={input} placeholder="Ваш ответ…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button style={{ ...S.btn, opacity: busy || !input.trim() ? 0.5 : 1 }} disabled={busy || !input.trim()} onClick={send}>Отправить</button>
        </div>
      )}
      {draft && <button style={{ ...S.btn2, marginTop: 10, alignSelf: "flex-start" }} disabled={busy || attempt.transcript.length < 3} onClick={finish}>Завершить кейс</button>}

      {attempt.status === "finished" && (
        <div style={{ ...S.card, marginTop: 10, background: C.warnBg }}>
          <div style={{ fontSize: 14, marginBottom: 10 }}>Кейс завершён. Нажмите кнопку, чтобы отправить вашу переписку руководителю программы для разбора.</div>
          <button style={S.btn} disabled={busy} onClick={submit}>Отправить разработчику</button>
        </div>
      )}
      {attempt.status === "submitted" && (
        <div style={{ ...S.card, marginTop: 10, background: C.okBg, color: C.ok }}>
          Отправлено. Спасибо! Разбор ошибок на занятии.
          <div><button style={{ ...S.btn2, marginTop: 10 }} onClick={onBack}>К заданиям</button></div>
        </div>
      )}
    </Shell>
  );
}

export default function StudyApp() {
  const [view, setView] = useState(() => (getToken() ? "loading" : "login")); // loading | login | consent | home | session
  const [home, setHome] = useState(null);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");

  const logout = useCallback(() => { setToken(""); setHome(null); setSession(null); setView("login"); }, []);

  const applyHome = useCallback((d) => {
    setHome(d);
    setView(d.resident.consent ? "home" : "consent");
  }, []);
  const onLoadError = useCallback((e) => {
    if (e.status === 401) logout();
    else { setError(e.message); setView("home"); }
  }, [logout]);
  const load = useCallback(() => api("GET", "home").then(applyHome, onLoadError), [applyHome, onLoadError]);

  useEffect(() => {
    if (getToken()) api("GET", "home").then(applyHome, onLoadError);
  }, [applyHome, onLoadError]);

  async function open(item) {
    setError("");
    try {
      const d = await api("POST", "start", { case_id: item.case_id, mode: item.mode });
      setSession(d.attempt);
      setView("session");
    } catch (e) { setError(e.message); }
  }

  if (view === "loading") return <Shell><div style={{ color: C.sub }}>Загрузка…</div></Shell>;
  if (view === "login") return <Login onDone={load} />;
  if (view === "consent") return <Consent resident={home.resident} onLogout={logout} onDone={load} />;
  if (view === "session") return <Session key={session.id} initial={session} resident={home.resident} onLogout={logout} onBack={() => { setView("loading"); load(); }} />;
  return <Home home={home || { resident: null, items: [] }} onOpen={open} onLogout={logout} error={error} reload={load} />;
}
