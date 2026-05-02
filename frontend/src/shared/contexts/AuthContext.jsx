/**
 * @module shared/contexts/AuthContext
 * @description Global authentication state with React Context.
 * Manages user session, tokens, and login/logout lifecycle.
 *
 * SESSION_VERSION:
 *   Bump this string whenever the shape or branding of the persisted user
 *   object changes in a way that would make cached data user-visibly wrong.
 *   On boot, if localStorage has a different version, all session keys are
 *   purged — the user is forced to re-login and the new session will carry
 *   the current brand / schema.
 *   History:
 *     'v1-2026-04-eldom'  — rebrand Verdi Naturals → ELDOM CORPORATION.
 *                           purges any cached user object that predates the
 *                           rebrand (admin@verdinaturals.com, "Administrador Verdi").
 */

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import api from '@/config/api';
import { ROLE_MODULES } from '@/config/constants';

const AuthContext = createContext(null);

const SESSION_VERSION = 'v1-2026-04-eldom';

const SESSION_KEYS = {
  ACCESS:  'accessToken',
  REFRESH: 'refreshToken',
  USER:    'user',
  VERSION: 'sessionVersion',
};

// Purge any session cache that predates the current SESSION_VERSION.
// Runs exactly once per page load, before any state is hydrated from storage.
const purgeIfStale = () => {
  try {
    const stored = localStorage.getItem(SESSION_KEYS.VERSION);
    if (stored !== SESSION_VERSION) {
      Object.values(SESSION_KEYS).forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(SESSION_KEYS.VERSION, SESSION_VERSION);
      if (stored) {
        // eslint-disable-next-line no-console
        console.info(
          `[auth] session cache purged (was "${stored}", now "${SESSION_VERSION}"). ` +
          `You will need to log in again.`
        );
      }
    }
  } catch {
    // localStorage unavailable (SSR / private mode) — nothing to do.
  }
};

purgeIfStale();

const loadFromStorage = () => {
  try {
    return {
      accessToken:  localStorage.getItem(SESSION_KEYS.ACCESS),
      refreshToken: localStorage.getItem(SESSION_KEYS.REFRESH),
      user:         JSON.parse(localStorage.getItem(SESSION_KEYS.USER) || 'null'),
    };
  } catch {
    return { accessToken: null, refreshToken: null, user: null };
  }
};

export const AuthProvider = ({ children }) => {
  const stored = loadFromStorage();

  const [user, setUser]               = useState(stored.user);
  const [accessToken, setAccessToken] = useState(stored.accessToken);
  const [loading, setLoading]         = useState(false);

  // Persist to localStorage on change
  useEffect(() => {
    if (user)        localStorage.setItem(SESSION_KEYS.USER, JSON.stringify(user));
    else             localStorage.removeItem(SESSION_KEYS.USER);
  }, [user]);

  useEffect(() => {
    if (accessToken) localStorage.setItem(SESSION_KEYS.ACCESS, accessToken);
    else             localStorage.removeItem(SESSION_KEYS.ACCESS);
  }, [accessToken]);

  const _applySession = useCallback(({ user: userData, accessToken: at, refreshToken: rt }) => {
    localStorage.setItem(SESSION_KEYS.REFRESH, rt);
    localStorage.setItem(SESSION_KEYS.VERSION, SESSION_VERSION);
    setAccessToken(at);
    setUser(userData);
  }, []);

  const login = useCallback(async (email, contrasena) => {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, contrasena });

      // Caso MFA: el backend devolvió challengeToken en vez de access/refresh.
      // Propagamos el flag para que LoginPage redirija al challenge.
      if (data.data?.mfa_required) {
        return { success: true, mfaRequired: true, challengeToken: data.data.challengeToken };
      }

      _applySession(data.data);
      return { success: true };
    } catch (err) {
      const message =
        err.response?.data?.error?.message || 'Error al iniciar sesión';
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  }, [_applySession]);

  const completeMfaChallenge = useCallback(async (challengeToken, code) => {
    setLoading(true);
    try {
      const { data } = await api.post('/auth/mfa/challenge', { challengeToken, code });
      _applySession(data.data);
      return { success: true };
    } catch (err) {
      const message =
        err.response?.data?.error?.message || 'Código MFA incorrecto';
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  }, [_applySession]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Continue with local logout even if server call fails
    } finally {
      Object.values(SESSION_KEYS).forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(SESSION_KEYS.VERSION, SESSION_VERSION);
      setUser(null);
      setAccessToken(null);
    }
  }, []);

  const canAccess = useCallback((module) => {
    if (!user) return false;
    if (user.rol === 'admin') return true;
    return ROLE_MODULES[user.rol]?.includes(module) ?? false;
  }, [user]);

  const isAuthenticated = Boolean(user && accessToken);

  return (
    <AuthContext.Provider value={{
      user,
      accessToken,
      loading,
      isAuthenticated,
      login,
      logout,
      canAccess,
      completeMfaChallenge,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
