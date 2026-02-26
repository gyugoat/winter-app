import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { isTauri } from '../utils/platform';
import { loadWebStore } from '../utils/web-store';
import { I18nContext, getTranslations, type Locale, type TranslationKey } from './index';

const STORE_FILE = 'settings.json';
const STORE_KEY = 'language';

async function getStore() {
  if (isTauri) {
    const { load } = await import('@tauri-apps/plugin-store');
    return load(STORE_FILE);
  }
  return loadWebStore(STORE_FILE);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    (async () => {
      try {
        const store = await getStore();
        const saved = await store.get<string>(STORE_KEY);
        if (saved && ['en', 'ko', 'ja', 'zh'].includes(saved)) {
          setLocaleState(saved as Locale);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(async (l: Locale) => {
    setLocaleState(l);
    try {
      const store = await getStore();
      await store.set(STORE_KEY, l);
      await store.save();
    } catch {}
  }, []);

  const translations = useMemo(() => getTranslations(locale), [locale]);
  const t = useCallback((key: TranslationKey) => translations[key], [translations]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return (
    <I18nContext.Provider value={value}>
      {children}
    </I18nContext.Provider>
  );
}
