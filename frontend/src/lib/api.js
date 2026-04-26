// Acepta cualquiera de las dos variables (la del .env.example era distinta de la
// que usaba api.js antes; aceptamos ambas para no romper la config existente).
const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  "";

const TOKEN_KEY = "zapateria_token";

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch(path, options = {}) {
  if (!API_BASE_URL) {
    throw new ApiError(
      "Falta la variable VITE_API_URL en Railway. Configúrala con la URL pública del backend.",
      0
    );
  }

  const token = getToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch (err) {
    throw new ApiError(`No se pudo contactar con el backend (${API_BASE_URL}): ${err.message}`, 0);
  }

  if (response.status === 204) return null;

  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!response.ok) {
    const message = (data && (data.detail || data.message)) || response.statusText || "Request failed";
    throw new ApiError(message, response.status);
  }

  return data;
}

export const API_BASE_URL_VALUE = API_BASE_URL;
