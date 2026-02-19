/**
 * Readme — scrollable onboarding document shown on first launch.
 *
 * The confirm button remains disabled until the user scrolls to the bottom,
 * ensuring they read the content. On confirm, sets `readme_seen = true` in
 * the Tauri Store, fades out, then calls onDone.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { load } from '@tauri-apps/plugin-store';
import { Titlebar } from './Titlebar';
import { Diamond } from './Diamond';
import { useI18n } from '../i18n';
import '../styles/readme.css';

const STORE_FILE = 'settings.json';
const STORE_KEY = 'readme_seen';

interface ReadmeProps {
  onDone: () => void;
}

export function Readme({ onDone }: ReadmeProps) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [reachedBottom, setReachedBottom] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || reachedBottom) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) {
      setReachedBottom(true);
    }
  }, [reachedBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 24) {
      setReachedBottom(true);
    }
  }, []);

  const handleConfirm = useCallback(async () => {
    try {
      const store = await load(STORE_FILE);
      await store.set(STORE_KEY, true);
      await store.save();
    } catch {}
    setFadeOut(true);
    setTimeout(onDone, 400);
  }, [onDone]);

  return (
    <div className={`readme${fadeOut ? ' readme-fade-out' : ''}`}>
      <Titlebar />
      <div className="readme-scroll" ref={scrollRef} onScroll={handleScroll}>
        <div className="readme-content">
          <div className="readme-header">
            <Diamond size={32} glow={true} className="readme-diamond" />
            <h1 className="readme-title">{t('readmeTitle')}</h1>
          </div>

          <section className="readme-section">
            <h2 className="readme-section-title">{t('readmeWhatIsWinter')}</h2>
            <p className="readme-section-body">{t('readmeWhatIsWinterBody')}</p>
          </section>

          <section className="readme-section">
            <h2 className="readme-section-title">{t('readmeHowToUse')}</h2>
            <p className="readme-section-body">{t('readmeHowToUseBody')}</p>
          </section>

          <section className="readme-section">
            <h2 className="readme-section-title">{t('readmeExamplesTitle')}</h2>
            <div className="readme-examples">
              <div className="readme-example">{t('readmeExample1')}</div>
              <div className="readme-example">{t('readmeExample2')}</div>
              <div className="readme-example">{t('readmeExample3')}</div>
            </div>
          </section>

          <section className="readme-section">
            <h2 className="readme-section-title">{t('readmeSessions')}</h2>
            <p className="readme-section-body">{t('readmeSessionsBody')}</p>
          </section>

          <section className="readme-section">
            <h2 className="readme-section-title">{t('readmeMobileTitle')}</h2>
            <p className="readme-section-body">{t('readmeMobileBody')}</p>
          </section>

          <section className="readme-section">
            <h2 className="readme-section-title">{t('readmeShortcutsTitle')}</h2>
            <p className="readme-section-body">{t('readmeShortcutsBody')}</p>
          </section>

          <section className="readme-section">
            <h2 className="readme-section-title">{t('readmeModelTitle')}</h2>
            <p className="readme-section-body">{t('readmeModelBody')}</p>
          </section>

          <section className="readme-section">
            <h2 className="readme-section-title">{t('readmeTips')}</h2>
            <ul className="readme-tips">
              <li>{t('readmeTip1')}</li>
              <li>{t('readmeTip2')}</li>
              <li>{t('readmeTip3')}</li>
            </ul>
          </section>
        </div>
      </div>

      <div className="readme-footer">
        <div className={`readme-scroll-hint${reachedBottom ? ' readme-scroll-hint-hidden' : ''}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
        <button
          className="readme-confirm-btn"
          disabled={!reachedBottom}
          onClick={handleConfirm}
        >
          {t('readmeConfirm')}
        </button>
      </div>
    </div>
  );
}
