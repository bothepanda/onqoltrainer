// Локальный запуск /api/study без Vercel CLI: node scripts/dev-api.mjs
// Без DATABASE_URL данные пишутся в .data/store.json. STUDY_MOCK=1 подменяет модель заглушкой.
import { createServer } from "node:http";
import handler from "../api/study.js";

const PORT = Number(process.env.API_PORT || 3001);
createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (!url.pathname.startsWith("/api/study")) {
    res.writeHead(404).end();
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
  req.query = Object.fromEntries(url.searchParams);
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); return res; };
  res.send = (s) => { res.end(s); return res; };
  await handler(req, res);
}).listen(PORT, () => console.log(`dev api: http://localhost:${PORT}`));
