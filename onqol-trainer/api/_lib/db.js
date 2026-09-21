// Хранилище учебных попыток.
// Продакшн: Neon Postgres (DATABASE_URL). Локально без базы: JSON-файл .data/store.json.
import { neon } from "@neondatabase/serverless";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// ─── Neon ────────────────────────────────────────────────────────────────
function pgStore(url) {
  const sql = neon(url);
  return {
    kind: "neon",
    async init() {
      await sql`CREATE TABLE IF NOT EXISTS residents (
        id text PRIMARY KEY,
        pgy int,
        pin_hash text NOT NULL,
        consent_at timestamptz,
        fail_count int NOT NULL DEFAULT 0,
        locked_until timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
      await sql`CREATE TABLE IF NOT EXISTS attempts (
        id text PRIMARY KEY,
        resident_id text NOT NULL REFERENCES residents(id),
        case_id text NOT NULL,
        case_version text NOT NULL,
        case_hash text NOT NULL,
        mode text NOT NULL,
        status text NOT NULL DEFAULT 'draft',
        model text,
        transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
        started_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz,
        submitted_at timestamptz,
        UNIQUE (resident_id, case_id, mode)
      )`;
    },
    async getResident(id) {
      const r = await sql`SELECT * FROM residents WHERE id = ${id}`;
      return r[0] || null;
    },
    async saveResident({ id, pgy, pin_hash }) {
      await sql`INSERT INTO residents (id, pgy, pin_hash) VALUES (${id}, ${pgy}, ${pin_hash})
        ON CONFLICT (id) DO UPDATE SET pgy = EXCLUDED.pgy, pin_hash = EXCLUDED.pin_hash,
        fail_count = 0, locked_until = NULL`;
    },
    async listResidents() {
      return sql`SELECT id, pgy, consent_at, created_at FROM residents ORDER BY id`;
    },
    async setFail(id, failCount, lockedUntil) {
      await sql`UPDATE residents SET fail_count = ${failCount}, locked_until = ${lockedUntil} WHERE id = ${id}`;
    },
    async setConsent(id) {
      await sql`UPDATE residents SET consent_at = now() WHERE id = ${id} AND consent_at IS NULL`;
    },
    async getAttempt(id) {
      const r = await sql`SELECT * FROM attempts WHERE id = ${id}`;
      return r[0] || null;
    },
    async findAttempt(residentId, caseId, mode) {
      const r = await sql`SELECT * FROM attempts WHERE resident_id = ${residentId} AND case_id = ${caseId} AND mode = ${mode}`;
      return r[0] || null;
    },
    async createAttempt(a) {
      await sql`INSERT INTO attempts (id, resident_id, case_id, case_version, case_hash, mode, transcript)
        VALUES (${a.id}, ${a.resident_id}, ${a.case_id}, ${a.case_version}, ${a.case_hash}, ${a.mode}, ${JSON.stringify(a.transcript)}::jsonb)`;
    },
    // Дописывает реплики, только если длина транскрипта совпала с ожидаемой (защита от двойной отправки).
    async appendTurn(id, expectedLen, msgs, model) {
      const r = await sql`UPDATE attempts SET transcript = transcript || ${JSON.stringify(msgs)}::jsonb,
        updated_at = now(), model = COALESCE(${model}, model)
        WHERE id = ${id} AND status = 'draft' AND jsonb_array_length(transcript) = ${expectedLen}
        RETURNING jsonb_array_length(transcript) AS n`;
      return r[0] ? r[0].n : null;
    },
    async setStatus(id, status) {
      if (status === "finished") {
        await sql`UPDATE attempts SET status = ${status}, finished_at = now(), updated_at = now() WHERE id = ${id}`;
      } else if (status === "submitted") {
        await sql`UPDATE attempts SET status = ${status}, submitted_at = now(), updated_at = now() WHERE id = ${id}`;
      } else {
        await sql`UPDATE attempts SET status = ${status}, updated_at = now() WHERE id = ${id}`;
      }
    },
    async listAttempts(residentId) {
      if (residentId) return sql`SELECT * FROM attempts WHERE resident_id = ${residentId} ORDER BY started_at`;
      return sql`SELECT * FROM attempts ORDER BY resident_id, started_at`;
    },
    async deleteAttempt(id) {
      await sql`DELETE FROM attempts WHERE id = ${id}`;
    },
  };
}

// ─── Локальный файл (только для разработки и тестов) ─────────────────────
function fileStore() {
  const dir = join(process.cwd(), ".data");
  const file = join(dir, "store.json");
  const load = () => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { residents: {}, attempts: {} });
  const save = (d) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(d, null, 2));
  };
  const now = () => new Date().toISOString();
  return {
    kind: "file",
    async init() {},
    async getResident(id) { return load().residents[id] || null; },
    async saveResident({ id, pgy, pin_hash }) {
      const d = load();
      const old = d.residents[id] || {};
      d.residents[id] = { ...old, id, pgy, pin_hash, fail_count: 0, locked_until: null, consent_at: old.consent_at || null, created_at: old.created_at || now() };
      save(d);
    },
    async listResidents() {
      return Object.values(load().residents)
        .map((r) => ({ id: r.id, pgy: r.pgy, consent_at: r.consent_at, created_at: r.created_at }))
        .sort((a, b) => a.id.localeCompare(b.id));
    },
    async setFail(id, failCount, lockedUntil) {
      const d = load();
      d.residents[id].fail_count = failCount;
      d.residents[id].locked_until = lockedUntil ? new Date(lockedUntil).toISOString() : null;
      save(d);
    },
    async setConsent(id) {
      const d = load();
      if (!d.residents[id].consent_at) d.residents[id].consent_at = now();
      save(d);
    },
    async getAttempt(id) { return load().attempts[id] || null; },
    async findAttempt(rid, cid, mode) {
      return Object.values(load().attempts).find((a) => a.resident_id === rid && a.case_id === cid && a.mode === mode) || null;
    },
    async createAttempt(a) {
      const d = load();
      d.attempts[a.id] = { ...a, status: "draft", model: null, started_at: now(), updated_at: now(), finished_at: null, submitted_at: null };
      save(d);
    },
    async appendTurn(id, expectedLen, msgs, model) {
      const d = load();
      const a = d.attempts[id];
      if (!a || a.status !== "draft" || a.transcript.length !== expectedLen) return null;
      a.transcript.push(...msgs);
      a.updated_at = now();
      if (model) a.model = model;
      save(d);
      return a.transcript.length;
    },
    async setStatus(id, status) {
      const d = load();
      const a = d.attempts[id];
      a.status = status;
      a.updated_at = now();
      if (status === "finished") a.finished_at = now();
      if (status === "submitted") a.submitted_at = now();
      save(d);
    },
    async listAttempts(rid) {
      const all = Object.values(load().attempts).sort((a, b) => (a.resident_id + a.started_at).localeCompare(b.resident_id + b.started_at));
      return rid ? all.filter((a) => a.resident_id === rid) : all;
    },
    async deleteAttempt(id) {
      const d = load();
      delete d.attempts[id];
      save(d);
    },
  };
}

let store;
export async function getStore() {
  if (store) return store;
  if (process.env.DATABASE_URL) {
    store = pgStore(process.env.DATABASE_URL);
  } else if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL не задан");
  } else {
    store = fileStore();
  }
  await store.init();
  return store;
}
