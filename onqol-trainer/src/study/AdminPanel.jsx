import { useState } from "react";
import { api } from "./api";

const box = { background: "#fff", border: "1px solid rgba(22,105,122,0.18)", borderRadius: 10, padding: 16, marginBottom: 14 };
const btn = { background: "#16697A", color: "#fff", border: 0, borderRadius: 8, padding: "9px 14px", fontSize: 13, cursor: "pointer", fontFamily: "inherit", marginRight: 8 };
const input = { width: "100%", boxSizing: "border-box", padding: "9px 10px", border: "1px solid rgba(22,105,122,0.25)", borderRadius: 8, fontSize: 14, fontFamily: "inherit" };
const th = { textAlign: "left", padding: "4px 8px", fontSize: 12, color: "#3a7a84", borderBottom: "1px solid #ddd" };
const td = { padding: "4px 8px", fontSize: 13, borderBottom: "1px solid #eee" };

export default function AdminPanel() {
  const [token, setToken] = useState(() => { try { return sessionStorage.getItem("onqol_admin") || ""; } catch { return ""; } });
  const [data, setData] = useState(null);
  const [list, setList] = useState("R01:2\nR02:3\nR03:3\nR04:4\nR05:4\nR06:5\nR07:5\nR08:5");
  const [made, setMade] = useState(null);
  const [msg, setMsg] = useState("");

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
    <div style={{ fontFamily: "'IBM Plex Mono','Courier New',monospace", background: "#f2f7f8", minHeight: "100dvh", padding: 16 }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ fontSize: 18 }}>ON QOL · администратор</h1>
        <div style={box}>
          <input style={input} type="password" placeholder="ADMIN_TOKEN" value={token} onChange={(e) => setToken(e.target.value)} />
          <div style={{ marginTop: 10 }}>
            <button style={btn} onClick={overview}>Показать данные</button>
            <button style={btn} onClick={setup}>Создать таблицы (один раз)</button>
            <button style={btn} onClick={() => download("csv")}>Скачать CSV</button>
            <button style={btn} onClick={() => download("json")}>Скачать JSON</button>
          </div>
          {msg && <div style={{ color: "#c0392b", marginTop: 10, fontSize: 13 }}>{msg}</div>}
        </div>

        <div style={box}>
          <b style={{ fontSize: 14 }}>Резиденты</b>
          <p style={{ fontSize: 12, color: "#3a7a84" }}>По строке на человека: ID и год резидентуры (R01:2). Тестовые ID начинаются с T (видят все задания без ожидания даты).</p>
          <textarea style={{ ...input, minHeight: 120 }} value={list} onChange={(e) => setList(e.target.value)} />
          <button style={{ ...btn, marginTop: 10 }} onClick={create}>Создать и выдать PIN</button>
          {made && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: "#c0392b" }}>PIN показан один раз. Запишите и передайте каждому лично.</div>
              <table style={{ borderCollapse: "collapse", marginTop: 6 }}><tbody>
                {made.map((m) => <tr key={m.id}><td style={td}>{m.id}</td><td style={td}>год {m.pgy ?? "—"}</td><td style={{ ...td, fontWeight: 700 }}>{m.pin}</td></tr>)}
              </tbody></table>
            </div>
          )}
        </div>

        {data && (
          <>
            <div style={box}>
              <b style={{ fontSize: 14 }}>Кейсы (версия и хэш пишутся в каждую попытку)</b>
              <div style={{ fontSize: 13, marginTop: 6 }}>{data.cases.map((c) => `${c.id} v${c.version} #${c.hash}`).join(" · ")} · хранилище: {data.backend}</div>
            </div>
            <div style={box}>
              <b style={{ fontSize: 14 }}>Резиденты ({data.residents.length})</b>
              <table style={{ borderCollapse: "collapse", marginTop: 6, width: "100%" }}>
                <thead><tr><th style={th}>ID</th><th style={th}>Год</th><th style={th}>Согласие</th></tr></thead>
                <tbody>{data.residents.map((r) => <tr key={r.id}><td style={td}>{r.id}</td><td style={td}>{r.pgy ?? "—"}</td><td style={td}>{r.consent_at ? new Date(r.consent_at).toLocaleString("ru-RU") : "нет"}</td></tr>)}</tbody>
              </table>
            </div>
            <div style={box}>
              <b style={{ fontSize: 14 }}>Попытки ({data.attempts.length})</b>
              <table style={{ borderCollapse: "collapse", marginTop: 6, width: "100%" }}>
                <thead><tr><th style={th}>Резидент</th><th style={th}>Кейс</th><th style={th}>Режим</th><th style={th}>Статус</th><th style={th}>Реплик</th><th style={th} /></tr></thead>
                <tbody>{data.attempts.map((a) => (
                  <tr key={a.id}><td style={td}>{a.resident_id}</td><td style={td}>{a.case_id} v{a.case_version}</td><td style={td}>{a.mode === "retest" ? "повтор" : "первый"}</td><td style={td}>{a.status}</td><td style={td}>{a.messages}</td>
                    <td style={td}><button style={{ ...btn, background: "#8a3b3b", padding: "3px 8px", fontSize: 11 }} onClick={() => reset(a.id)}>сброс</button></td></tr>
                ))}</tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
