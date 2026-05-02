/**
 * @module config/api
 * @description Axios instance with JWT injection, token refresh, and error normalization.
 */

import axios from 'axios';
import toast from 'react-hot-toast';

// Ruta RELATIVA al origen del frontend.
//   - En local dev (http://localhost:5173) → Vite proxy reenvía /api → :4000.
//   - A través de ngrok/cloudflared (https://xxx.ngrok-free.dev) → la petición
//     sale al mismo host público, Vite la proxea igual; sin mixed-content ni CORS.
//   - Producción sirviendo frontend estático detrás del backend → mismo origen,
//     la petición llega al backend sin necesidad de CORS.
//
// Si necesitas apuntar a un backend distinto (e.g. staging remoto) fija
// VITE_API_URL en .env.local con la URL absoluta — esa anula el default.
const BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Request Interceptor: Inject Access Token ─────────────────────────────────

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

// ─── Response Interceptor: Handle 401 + Token Refresh ─────────────────────────

let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => (error ? prom.reject(error) : prom.resolve(token)));
  failedQueue = [];
};

/**
 * Endpoints that must NEVER trigger the refresh+retry machinery.
 * - /auth/login  → a 401 here means "wrong credentials"; it must surface to the
 *   UI so LoginPage can render the error. Triggering refresh would redirect
 *   and swallow the message.
 * - /auth/refresh → a 401 here means the refresh token itself is dead; trying
 *   to refresh the refresh would loop.
 */
const isAuthEndpoint = (url = '') =>
  url.includes('/auth/login') || url.includes('/auth/refresh');

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config || {};

    // Never attempt refresh/retry for the auth endpoints themselves.
    if (error.response?.status === 401 && isAuthEndpoint(original.url)) {
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !original._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            original.headers.Authorization = `Bearer ${token}`;
            return api(original);
          })
          .catch((err) => Promise.reject(err));
      }

      original._retry = true;
      isRefreshing = true;

      const refreshToken = localStorage.getItem('refreshToken');

      if (!refreshToken) {
        isRefreshing = false;
        clearSession();
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
        const newToken = data.data.accessToken;
        // El backend rota el refresh token (OAuth 2.1): guardamos el nuevo.
        // Si el backend aún no rotara, respetamos y mantenemos el anterior.
        const rotatedRefresh = data.data.refreshToken;
        if (rotatedRefresh) {
          localStorage.setItem('refreshToken', rotatedRefresh);
        }
        localStorage.setItem('accessToken', newToken);
        api.defaults.headers.common.Authorization = `Bearer ${newToken}`;
        processQueue(null, newToken);
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch (refreshError) {
        processQueue(refreshError, null);
        clearSession();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // Show error toast for non-401 errors, unless caller opted out with { silent: true }.
    // Used by forms (e.g. change-password modal) that render the error inline
    // and don't want a duplicate global toast.
    const message =
      error.response?.data?.error?.message ||
      error.message ||
      'Error inesperado';

    if (error.response?.status !== 401 && !original.silent) {
      toast.error(message);
    }

    return Promise.reject(error);
  }
);

const clearSession = () => {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  window.location.href = '/login';
};

export default api;
