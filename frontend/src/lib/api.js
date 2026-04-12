const API_BASE_URL = import.meta.env.VITE_API_URL;

// Si no existe la variable, fallamos explícitamente (evita usar localhost en producción)
if (!API_BASE_URL) {
  throw new Error("Missing VITE_API_URL environment variable");
}

export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem("zapateria_token");

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let message = "Request failed";

    try {
      const data = await response.json();
      message = data.detail || message;
    } catch {
      // ignore si no hay JSON
    }

    throw new Error(message);
  }

  return response.json();
}

export { API_BASE_URL };