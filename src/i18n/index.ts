import { createContext, useContext } from 'react';
import { en, type TranslationKey } from './en';
import { ko } from './ko';
import { ja } from './ja';
import { zh } from './zh';

export type Locale = 'en' | 'ko' | 'ja' | 'zh';

const TRANSLATIONS: Record<Locale, Record<TranslationKey, string>> = { en, ko, ja, zh };

export interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: TranslationKey) => string;
}

export const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  setLocale: () => {},
  t: (key) => en[key],
});

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export function getTranslations(locale: Locale): Record<TranslationKey, string> {
  return TRANSLATIONS[locale] ?? en;
}

export type { TranslationKey };
