import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

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
