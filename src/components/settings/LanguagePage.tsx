/**
 * LanguagePage — UI language picker (EN / KO / JP / CN).
 *
 * Uses useI18n to read and set the active locale. Active locale
 * is highlighted with accent color; others are muted.
 */
import { useI18n, type Locale } from '../../i18n';
import '../../styles/settings-language.css';

const SUPPORTED_LANGUAGES: { locale: Locale; code: string; name: string }[] = [
  { locale: 'en', code: 'EN', name: 'English' },
  { locale: 'ko', code: 'KO', name: 'Korean' },
  { locale: 'ja', code: 'JP', name: 'Japanese' },
  { locale: 'zh', code: 'CN', name: 'Chinese' },
];

interface LanguagePageProps {
  /** Click-flash ripple handler from useClickFlash */
  onFlash: (e: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Settings page for selecting the UI display language.
 *
 * @param onFlash - ripple effect callback on language item click
 */
export function LanguagePage({ onFlash }: LanguagePageProps) {
  const { locale, setLocale } = useI18n();

  return (
    <div className="settings-language-list">
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button
          key={lang.code}
          className={`settings-language-item${locale === lang.locale ? ' active' : ''}`}
          onClick={(e) => { onFlash(e); setLocale(lang.locale); }}
        >
          <span className="settings-language-code">{lang.code}</span>
          <span className="settings-language-name">{lang.name}</span>
        </button>
      ))}
    </div>
  );
}
