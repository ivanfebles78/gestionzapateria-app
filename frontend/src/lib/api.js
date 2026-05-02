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

function buildHeaders(options) {
  const token = getToken();
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  // Solo añadimos JSON content-type si no es FormData ni hay header explícito.
  if (!isFormData && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

export async function apiFetch(path, options = {}) {
  if (!API_BASE_URL) {
    throw new ApiError(
      "Falta la variable VITE_API_URL en Railway. Configúrala con la URL pública del backend.",
      0
    );
  }

  const headers = buildHeaders(options);

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

// Descarga un endpoint como blob (para Excel y ZIP) y dispara el "Save As".
export async function apiDownload(path, suggestedFilename) {
  if (!API_BASE_URL) {
    throw new ApiError("Falta la variable VITE_API_URL en Railway.", 0);
  }
  const token = getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { headers });
  } catch (err) {
    throw new ApiError(`No se pudo contactar con el backend (${API_BASE_URL}): ${err.message}`, 0);
  }

  if (!response.ok) {
    let message = response.statusText || "Request failed";
    try {
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (data?.detail) message = data.detail;
    } catch {}
    throw new ApiError(message, response.status);
  }

  // Intenta extraer el filename del header Content-Disposition.
  let filename = suggestedFilename || "download";
  const cd = response.headers.get("Content-Disposition");
  if (cd) {
    const match = /filename="?([^"]+)"?/i.exec(cd);
    if (match?.[1]) filename = match[1];
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Devuelve la respuesta como Blob (útil para previsualizar imágenes en pestaña nueva).
export async function apiBlob(path) {
  if (!API_BASE_URL) {
    throw new ApiError("Falta la variable VITE_API_URL en Railway.", 0);
  }
  const token = getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { headers });
  } catch (err) {
    throw new ApiError(`No se pudo contactar con el backend (${API_BASE_URL}): ${err.message}`, 0);
  }

  if (!response.ok) {
    let message = response.statusText || "Request failed";
    try {
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (data?.detail) message = data.detail;
    } catch {}
    throw new ApiError(message, response.status);
  }
  return response.blob();
}

export const API_BASE_URL_VALUE = API_BASE_URL;
