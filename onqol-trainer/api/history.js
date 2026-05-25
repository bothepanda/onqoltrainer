import { put, del, list } from "@vercel/blob";

export const config = { api: { bodyParser: true } };

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readHistory(uid) {
  try {
    const { blobs } = await list({ prefix: `history/${uid}.json`, limit: 1 });
    if (!blobs.length) return [];
    const r = await fetch(blobs[0].url);
    const d = await r.json();
    return Array.isArray(d.history) ? d.history : [];
  } catch {
    return [];
  }
}

async function writeHistory(uid, history) {
  const prefix = `history/${uid}.json`;
  const { blobs } = await list({ prefix, limit: 1 });
  if (blobs.length) await del(blobs[0].url);
  await put(prefix, JSON.stringify({ history }), {
    access: "public",
    addRandomSuffix: false,
  });
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  const uid = (req.query.uid || "").replace(/[^a-z0-9]/gi, "").slice(0, 32);
  if (!uid) return res.status(400).json({ error: "missing uid" });

  if (req.method === "GET") {
    return res.json({ history: await readHistory(uid) });
  }

  if (req.method === "POST") {
    const label = (req.body?.label || "").slice(0, 120);
    const history = await readHistory(uid);
    if (label && !history.includes(label)) {
      history.push(label);
      if (history.length > 30) history.splice(0, history.length - 30);
    }
    await writeHistory(uid, history);
    return res.json({ history });
  }

  if (req.method === "DELETE") {
    const { blobs } = await list({ prefix: `history/${uid}.json`, limit: 1 });
    if (blobs.length) await del(blobs[0].url);
    return res.json({ history: [] });
  }

  return res.status(405).json({ error: "method not allowed" });
}
