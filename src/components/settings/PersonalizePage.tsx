/**
 * PersonalizePage — MBTI personality selector, automation link, mobile link.
 *
 * Owns: mbtiLetters state (persisted via Tauri Store).
 * Delegates: MobileLinkCard (self-contained), automation nav (via onNavigate prop).
 */
import { useState, useEffect } from 'react';
import { load } from '@tauri-apps/plugin-store';
import type { SettingsPageId } from '../Chat';
import { Diamond } from '../Diamond';
import { MBTI_PERSONALITIES } from '../../data/mbti-personalities';
import { useI18n } from '../../i18n';
import { MobileLinkCard } from './MobileLinkCard';
import '../../styles/settings-personalize.css';

const MBTI_PAIRS: [string, string][] = [['I', 'E'], ['N', 'S'], ['T', 'F'], ['J', 'P']];

interface PersonalizePageProps {
  /** Click-flash ripple handler from useClickFlash */
  onFlash: (e: React.MouseEvent<HTMLElement>) => void;
  /** Navigate to another settings page (e.g. 'automation') */
  onNavigate?: (page: SettingsPageId) => void;
}

/**
 * Settings page for personalizing Winter's behavior and appearance.
 *
 * @param onFlash    - ripple effect callback
 * @param onNavigate - callback to navigate to another settings page
 */
export function PersonalizePage({ onFlash, onNavigate }: PersonalizePageProps) {
  const { t } = useI18n();
  const [mbtiLetters, setMbtiLetters] = useState<string[]>(['I', 'N', 'T', 'J']);
  const [animatingIdx, setAnimatingIdx] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const store = await load('settings.json');
        const saved = await store.get<string>('mbti_type');
        if (saved && typeof saved === 'string' && saved.length === 4) {
          setMbtiLetters(saved.split(''));
        }
      } catch {}
    })();
  }, []);

  const randomizeMbti = async (e: React.MouseEvent<HTMLElement>) => {
    onFlash(e);
    const newLetters = MBTI_PAIRS.map(pair => pair[Math.random() < 0.5 ? 0 : 1]);

    for (let i = 0; i < 4; i++) {
      setTimeout(() => {
        setAnimatingIdx(i);
        setMbtiLetters(prev => {
          const next = [...prev];
          next[i] = newLetters[i];
          return next;
        });
      }, i * 120);
    }

    setTimeout(() => setAnimatingIdx(null), 4 * 120 + 300);

    try {
      const mbtiType = newLetters.join('');
      const personality = MBTI_PERSONALITIES[mbtiType as keyof typeof MBTI_PERSONALITIES];
      const store = await load('settings.json');
      await store.set('mbti_type', mbtiType);
      if (personality) {
        await store.set('mbti_prompt_modifier', personality.promptModifier);
      }
      await store.save();
    } catch {}
  };

  return (
    <div className="settings-personalize-cards">
      <MobileLinkCard onFlash={onFlash} />
      <button className="settings-card settings-card-nav" onClick={(e) => { onFlash(e); onNavigate?.('automation'); }}>
        <div className="settings-card-row">
          <span className="settings-card-title settings-card-title-italic">{t('personalizeAutomation')}</span>
          <span className="settings-card-nav-chevron">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
        </div>
        <span className="settings-card-subtitle">{t('personalizeAutomationSubtitle')}</span>
      </button>
      <div className="settings-card">
        <div className="settings-card-row">
          <span className="settings-card-title">{t('personalizeWinterIs')}</span>
          <div className="settings-badges">
            {mbtiLetters.map((letter, i) => (
              <span
                key={i}
                className={`settings-badge${animatingIdx !== null && i <= animatingIdx ? ' settings-badge-pop' : ''}`}
              >
                {letter}
              </span>
            ))}
            <button className="settings-mbti-diamond-btn" onClick={randomizeMbti}>
              <Diamond size={16} glow={true} className="settings-mbti-diamond" />
            </button>
          </div>
        </div>
        <span className="settings-card-subtitle">
          {t('personalizeFeelingLucky') + ' \u00b7 '}
          <span className="settings-card-link">{t('personalizeSomethingFun')}</span>
        </span>
      </div>
    </div>
  );
}
