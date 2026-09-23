import { useState, useEffect, useCallback } from "react";
import { api } from "./api";

const box = { background: "#fff", border: "1px solid rgba(22,105,122,0.18)", borderRadius: 10, padding: 16, marginBottom: 14 };
const btn = { background: "#16697A", color: "#fff", border: 0, borderRadius: 8, padding: "9px 14px", fontSize: 15, cursor: "pointer", fontFamily: "inherit", marginRight: 8 };
const input = { width: "100%", boxSizing: "border-box", padding: "9px 10px", border: "1px solid rgba(22,105,122,0.25)", borderRadius: 8, fontSize: 16, fontFamily: "inherit" };
const th = { textAlign: "left", padding: "4px 8px", fontSize: 14, color: "#2c5f68", borderBottom: "1px solid #ddd" };
const td = { padding: "6px 8px", fontSize: 15, borderBottom: "1px solid #eee" };


const SCORE = { 2: "сам", 1: "после подсказки", 0: "нет" };
const pct = (x) => (x == null ? "—" : `${Math.round(x * 100)}%`);

function GradeView({ attemptId, token, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState({});
  const [flags, setFlags] = useState({ c1: false, c2: false });
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = useCallback((r) => {
    setD(r);
    const src = r.human || r.model;
    setEdit(Object.fromEntries((src?.items || []).map((i) => [i.n, i.score])));
    setFlags({ c1: !!src?.flags?.c1?.value, c2: !!src?.flags?.c2?.value });
    setNote(r.human?.note || "");
  }, []);
  const load = () => api("GET", `admin/grading?attempt_id=${attemptId}`, null, { admin: token }).then(apply);
  useEffect(() => {
    api("GET", `admin/grading?attempt_id=${attemptId}`, null, { admin: token }).then(apply).catch((e) => setMsg(e.message));
  }, [attemptId, token, apply]);

  const run = async (fn) => { setBusy(true); setMsg(""); try { await fn(); } catch (e) { setMsg(e.message); } finally { setBusy(false); } };
  const gradeByModel = () => run(async () => { await api("POST", "admin/grade", { attempt_id: attemptId }, { admin: token }); await load(); onChanged(); });
  const save = () => run(async () => {
    await api("POST", "admin/grade-review", { attempt_id: attemptId, items: Object.entries(edit).map(([n, score]) => ({ n: Number(n), score })), flags, note }, { admin: token });
    await load(); onChanged(); setMsg("Проверка сохранена");
  });

  if (!d) return <div style={box}>{msg || "Загрузка…"}</div>;
  const retest = d.attempt.mode === "retest";
  const m = d.model;
  const modelItem = (n) => m?.items.find((i) => i.n === n);
  const metrics = d.human?.metrics || m?.metrics;
  return (
    <div style={{ ...box, borderColor: "#16697A" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ fontSize: 16 }}>{d.attempt.resident_id} · {d.attempt.case_id} v{d.attempt.case_version} · {retest ? "повтор" : "первое прохождение"}</b>
        <span style={{ flex: 1 }} />
        <button style={btn} disabled={busy} onClick={gradeByModel}>{m ? "Оценить заново моделью" : "Оценить моделью"}</button>
        <button style={{ ...btn, background: "#666", marginRight: 0 }} onClick={onClose}>Закрыть</button>
      </div>
      {msg && <div style={{ color: msg.includes("сохранена") ? "#1b7a4b" : "#c0392b", fontSize: 15, marginTop: 8 }}>{msg}</div>}
      {metrics && <div style={{ fontSize: 15, margin: "10px 0" }}>
        {d.human ? "Проверено вами" : "Оценка модели, не проверена"}: самостоятельность {pct(metrics.independence)} · общий балл {pct(metrics.weighted)} · сам {metrics.self_items}, после подсказки {metrics.hint_items}, нет {metrics.missed_items}
      </div>}
      {!m && !d.human && <div style={{ fontSize: 15 }}>Оценки пока нет. Нажмите «Оценить моделью».</div>}
      <details style={{ margin: "8px 0" }}>
        <summary style={{ fontSize: 15, cursor: "pointer" }}>Переписка ({d.transcript.length})</summary>
        <div style={{ fontSize: 14, maxHeight: 320, overflow: "auto", background: "#fafafa", padding: 8, marginTop: 6 }}>
          {d.transcript.map((t, i) => (
            <div key={i} style={{ marginBottom: 8, whiteSpace: "pre-wrap", color: t.role === "user" ? "#0d2124" : "#2c5f68" }}>
              <b>#{i} {t.role === "user" ? "резидент" : "преподаватель"}{t.hints ? ` [подсказка: ${t.hints.map((h) => `п.${h.item} ур.${h.level}`).join(", ")}]` : ""}{t.truncated ? " [ОБРЕЗАНО]" : ""}:</b> {t.content}
            </div>
          ))}
        </div>
      </details>
      {(m || d.human) && (
        <>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr><th style={th}>№</th><th style={th}>Пункт</th><th style={th}>Вес</th><th style={th}>Модель</th><th style={th}>Ваша оценка</th></tr></thead>
            <tbody>{d.rubric.map((r) => {
              const mi = modelItem(r.n);
              return (
                <tr key={r.n}>
                  <td style={td}>{r.n}</td><td style={td}>{r.text}</td><td style={td}>{r.weight}</td>
                  <td style={{ ...td, fontSize: 14 }}>
                    {mi ? <><b>{SCORE[mi.score]}</b>{mi.hint_level ? ` (подск. ур.${mi.hint_level})` : ""}{mi.flags?.length ? ` ⚠ ${mi.flags.join(", ")}` : ""}{mi.evidence ? <div style={{ color: "#2c5f68" }}>«{mi.evidence}»</div> : null}</> : "—"}
                  </td>
                  <td style={td}>
                    <select value={edit[r.n] ?? 0} onChange={(e) => setEdit({ ...edit, [r.n]: Number(e.target.value) })} style={{ fontFamily: "inherit", padding: 4 }}>
                      <option value={2}>2 · сам</option>
                      {!retest && <option value={1}>1 · после подсказки</option>}
                      <option value={0}>0 · нет</option>
                    </select>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
          <div style={{ margin: "10px 0", fontSize: 15 }}>
            <label style={{ marginRight: 16 }}><input type="checkbox" checked={flags.c1} onChange={(e) => setFlags({ ...flags, c1: e.target.checked })} /> C1: диуретик до коррекции гиповолемии</label>
            <label><input type="checkbox" checked={flags.c2} onChange={(e) => setFlags({ ...flags, c2: e.target.checked })} /> C2: болюсы при признаках перегрузки</label>
          </div>
          <input style={input} placeholder="Заметка (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button style={{ ...btn, marginTop: 10 }} disabled={busy} onClick={save}>Сохранить мою проверку</button>
        </>
      )}
    </div>
  );
}

function CompareView({ token }) {
  const [d, setD] = useState(null);
  const [includeTest, setIncludeTest] = useState(false);
  const [msg, setMsg] = useState("");
  const load = async () => { setMsg(""); try { setD(await api("GET", `admin/compare${includeTest ? "?include_test=1" : ""}`, null, { admin: token })); } catch (e) { setMsg(e.message); } };
  return (
    <div style={box}>
      <b style={{ fontSize: 16 }}>Сравнение первого прохождения и повтора</b>
      <div style={{ margin: "8px 0" }}>
        <button style={btn} onClick={load}>Сравнить</button>
        <label style={{ fontSize: 14 }}><input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} /> включая тестовые ID (T…)</label>
      </div>
      {msg && <div style={{ color: "#c0392b", fontSize: 15 }}>{msg}</div>}
      {d && (d.pairs.length === 0
        ? <div style={{ fontSize: 15 }}>Пар с оценкой нет: нужны оба прохождения, завершённые и оценённые.</div>
        : <>
          <div style={{ fontSize: 15, margin: "6px 0" }}>Пар: {d.group.n} · самостоятельность {pct(d.group.independence.first)} → {pct(d.group.independence.retest)} · общий балл {pct(d.group.weighted.first)} → {pct(d.group.weighted.retest)}</div>
          <div style={{ fontSize: 14, marginBottom: 8 }}>Переходы (пунктов): {Object.entries(d.group.transitions).map(([k, v]) => `${k} ${v}`).join(" · ")}</div>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr><th style={th}>Резидент</th><th style={th}>Год</th><th style={th}>Самост. 1-й → повтор</th><th style={th}>Общий балл</th><th style={th}>Переходы</th><th style={th}>Источник</th></tr></thead>
            <tbody>{d.pairs.map((p) => (
              <tr key={p.resident_id + p.case_id}>
                <td style={td}>{p.resident_id}</td><td style={td}>{p.pgy ?? "—"}</td>
                <td style={td}>{pct(p.comparison.first.independence)} → {pct(p.comparison.retest.independence)}</td>
                <td style={td}>{pct(p.comparison.first.weighted)} → {pct(p.comparison.retest.weighted)}</td>
                <td style={{ ...td, fontSize: 14 }}>{Object.entries(p.comparison.counts).map(([k, v]) => `${k} ${v}`).join(", ")}</td>
                <td style={{ ...td, fontSize: 14 }}>{p.source.first === "human" ? "вы" : "модель"} / {p.source.retest === "human" ? "вы" : "модель"}</td>
              </tr>
            ))}</tbody>
          </table>
        </>)}
    </div>
  );
}

function ImportView({ token, onDone }) {
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(false);
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMsg(""); setOk(false);
    try {
      const body = JSON.parse(await file.text());
      const r = await api("POST", "admin/grade-import", body, { admin: token });
      setOk(true);
      setMsg(`Загружено оценок: ${r.saved.length}. ${r.saved.map((x) => `${x.resident_id} ${x.mode === "retest" ? "повтор" : "первый"} ${Math.round(x.independence * 100)}%`).join(" · ")}`);
      onDone();
    } catch (err) { setMsg(err.message); }
  };
  return (
    <div style={box}>
      <b style={{ fontSize: 16 }}>Загрузить оценки из файла</b>
      <p style={{ fontSize: 14, color: "#2c5f68", margin: "6px 0 10px" }}>Файл gradings-import-….json, подготовленный после разбора выгрузки. Проверки (цитата есть в реплике резидента, понижение по метке подсказки, в повторе нет балла 1) применяются на сервере заново.</p>
      <input type="file" accept=".json,application/json" onChange={pick} />
      {msg && <div style={{ color: ok ? "#1b7a4b" : "#c0392b", fontSize: 15, marginTop: 8 }}>{msg}</div>}
    </div>
  );
}

export default function AdminPanel() {
  const [token, setToken] = useState(() => { try { return sessionStorage.getItem("onqol_admin") || ""; } catch { return ""; } });
  const [data, setData] = useState(null);
  const [list, setList] = useState("R01:2\nR02:3\nR03:3\nR04:4\nR05:4\nR06:5\nR07:5\nR08:5");
  const [made, setMade] = useState(null);
  const [msg, setMsg] = useState("");
  const [gradeOf, setGradeOf] = useState(null);

  const run = async (fn) => { setMsg(""); try { await fn(); } catch (e) { setMsg(e.message); } };
  const remember = () => { try { sessionStorage.setItem("onqol_admin", token); } catch { /* ignore */ } };

  const overview = () => run(async () => { remember(); setData(await api("GET", "admin/overview", null, { admin: token })); });
  const setup = () => run(async () => { remember(); await api("POST", "admin/setup", {}, { admin: token }); setMsg("Таблицы в базе готовы"); });
  const create = () => run(async () => {
    remember();
    const residents = list.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [id, pgy] = l.split(/[:,;\s]+/); return { id, pgy: pgy ? Number(pgy) : null }; });
    if (!window.confirm(`Создать или сбросить PIN у ${residents.length} резидентов? У существующих ID PIN будет заменён.`)) return;
    setMade((await api("POST", "admin/residents", { residents }, { admin: token })).residents);
    await overview();
  });
  const download = (format) => run(async () => {
    const r = await fetch(`/api/study/admin/export?format=${format}`, { headers: { "x-admin-token": token } });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Ошибка ${r.status}`);
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `onqol-study-${new Date().toISOString().slice(0, 10)}.${format}`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const reset = (id) => run(async () => {
    if (!window.confirm("Удалить эту попытку безвозвратно? Резидент сможет пройти кейс заново.")) return;
    await api("POST", "admin/reset", { attempt_id: id }, { admin: token });
    await overview();
  });

  return (
    <div style={{ fontFamily: "'IBM Plex Mono','Courier New',monospace", background: "#f2f7f8", color: "#0d2124", minHeight: "100dvh", padding: 16 }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22 }}>ON QOL · администратор</h1>
        <div style={box}>
          <input style={input} type="password" placeholder="ADMIN_TOKEN" value={token} onChange={(e) => setToken(e.target.value)} />
          <div style={{ marginTop: 10 }}>
            <button style={btn} onClick={overview}>Показать данные</button>
            <button style={btn} onClick={setup}>Создать таблицы (один раз)</button>
            <button style={btn} onClick={() => download("csv")}>Скачать CSV</button>
            <button style={btn} onClick={() => download("json")}>Скачать JSON</button>
          </div>
          {msg && <div style={{ color: "#c0392b", marginTop: 10, fontSize: 15 }}>{msg}</div>}
        </div>

        <div style={box}>
          <b style={{ fontSize: 16 }}>Резиденты</b>
          <p style={{ fontSize: 14, color: "#2c5f68" }}>По строке на человека: ID и год резидентуры (R01:2). Тестовые ID начинаются с T (видят все задания без ожидания даты).</p>
          <textarea style={{ ...input, minHeight: 120 }} value={list} onChange={(e) => setList(e.target.value)} />
          <button style={{ ...btn, marginTop: 10 }} onClick={create}>Создать и выдать PIN</button>
          {made && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 14, color: "#c0392b" }}>PIN показан один раз. Запишите и передайте каждому лично.</div>
              <table style={{ borderCollapse: "collapse", marginTop: 6 }}><tbody>
                {made.map((m) => <tr key={m.id}><td style={td}>{m.id}</td><td style={td}>год {m.pgy ?? "—"}</td><td style={{ ...td, fontWeight: 700 }}>{m.pin}</td></tr>)}
              </tbody></table>
            </div>
          )}
        </div>

        {data && (
          <>
            <div style={box}>
              <b style={{ fontSize: 16 }}>Кейсы (версия и хэш пишутся в каждую попытку)</b>
              <div style={{ fontSize: 15, marginTop: 6 }}>{data.cases.map((c) => `${c.id} v${c.version} #${c.hash}`).join(" · ")} · хранилище: {data.backend} · автооценка: {data.settings?.grading === "auto" ? "включена" : "выключена (оценки загружаются из файла)"}</div>
            </div>
            <div style={box}>
              <b style={{ fontSize: 16 }}>Резиденты ({data.residents.length})</b>
              <table style={{ borderCollapse: "collapse", marginTop: 6, width: "100%" }}>
                <thead><tr><th style={th}>ID</th><th style={th}>Год</th><th style={th}>Согласие</th></tr></thead>
                <tbody>{data.residents.map((r) => <tr key={r.id}><td style={td}>{r.id}</td><td style={td}>{r.pgy ?? "—"}</td><td style={td}>{r.consent_at ? new Date(r.consent_at).toLocaleString("ru-RU") : "нет"}</td></tr>)}</tbody>
              </table>
            </div>
            <div style={box}>
              <b style={{ fontSize: 16 }}>Попытки ({data.attempts.length})</b>
              <table style={{ borderCollapse: "collapse", marginTop: 6, width: "100%" }}>
                <thead><tr><th style={th}>Резидент</th><th style={th}>Кейс</th><th style={th}>Режим</th><th style={th}>Статус</th><th style={th}>Реплик</th><th style={th}>Оценка</th><th style={th} /></tr></thead>
                <tbody>{data.attempts.map((a) => (
                  <tr key={a.id}><td style={td}>{a.resident_id}</td><td style={td}>{a.case_id} v{a.case_version}</td><td style={td}>{a.mode === "retest" ? "повтор" : "первый"}</td><td style={td}>{a.status}</td><td style={td}>{a.messages}</td>
                    <td style={td}>{a.status === "draft" ? "—" : <button style={{ ...btn, padding: "3px 8px", fontSize: 13 }} onClick={() => setGradeOf(a.id)}>{a.graded.human ? "проверено" : a.graded.model ? "модель" : "оценить"}</button>}</td>
                    <td style={td}><button style={{ ...btn, background: "#8a3b3b", padding: "3px 8px", fontSize: 13 }} onClick={() => reset(a.id)}>сброс</button></td></tr>
                ))}</tbody>
              </table>
            </div>
            {gradeOf && <GradeView attemptId={gradeOf} token={token} onClose={() => setGradeOf(null)} onChanged={overview} />}
            <ImportView token={token} onDone={overview} />
            <CompareView token={token} />
          </>
        )}
      </div>
    </div>
  );
}
