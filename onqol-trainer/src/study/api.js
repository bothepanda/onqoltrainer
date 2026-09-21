const KEY = "onqol_study_token";

export const getToken = () => {
  try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
};
export const setToken = (t) => {
  try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch { /* приватный режим */ }
};

export async function api(method, path, body, { admin } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token && !admin) headers.Authorization = `Bearer ${token}`;
  if (admin) headers["x-admin-token"] = admin;
  let r;
  try {
    r = await fetch(`/api/study/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(new Error("Нет связи с сервером. Проверьте интернет и повторите"), { status: 0 });
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `Ошибка ${r.status}`), { status: r.status });
  return data;
}
