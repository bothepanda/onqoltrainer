import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";

function secret() {
  const s = process.env.SESSION_SECRET || process.env.ADMIN_TOKEN;
  if (!s) throw new Error("Не задан ADMIN_TOKEN (или SESSION_SECRET)");
  return createHmac("sha256", s).update("onqol-study-session-v1").digest();
}

export function hashPin(pin) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(pin), salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPin(pin, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [saltHex, hashHex] = stored.split(":");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(String(pin), Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

const b64 = (b) => Buffer.from(b).toString("base64url");

export function signToken(payload, ttlSeconds = 60 * 60 * 24 * 14) {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const sig = b64(createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = createHmac("sha256", secret()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
  } catch {
    return null;
  }
}

export function isAdmin(req) {
  const given = String(req.headers["x-admin-token"] || "");
  const real = process.env.ADMIN_TOKEN || "";
  if (!real || given.length !== real.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(real));
}

export function generatePin() {
  // 6 цифр, без ведущего нуля
  return String(100000 + (randomBytes(4).readUInt32BE() % 900000));
}
