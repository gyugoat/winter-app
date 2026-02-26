/**
 * useAuth — manages OAuth PKCE authentication state.
 *
 * On mount, checks whether a valid token already exists via the Rust backend.
 * Provides helpers to initiate the OAuth flow, exchange the code for a token,
 * and log out.
 *
 * @returns `{ isAuthenticated, loading, getAuthorizeUrl, exchangeCode, logout }`
 */
import { useState, useCallback, useEffect } from 'react';
import { invoke } from '../utils/invoke-shim';

/**
 * Hook for managing OAuth authentication state.
 * Bridges the Tauri Rust auth commands to React state.
 */
export function useAuth() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<boolean>('is_authenticated')
      .then((result) => {
        setAuthenticated(result);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const getAuthorizeUrl = useCallback(async (): Promise<string> => {
    return invoke<string>('get_authorize_url');
  }, []);

  const exchangeCode = useCallback(async (code: string) => {
    await invoke('exchange_code', { code });
    setAuthenticated(true);
  }, []);

  const logout = useCallback(async () => {
    await invoke('logout');
    setAuthenticated(false);
  }, []);

  return {
    isAuthenticated: authenticated,
    loading,
    getAuthorizeUrl,
    exchangeCode,
    logout,
  };
}
