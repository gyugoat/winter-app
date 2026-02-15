import { useState } from 'react';
import type { SettingsPageId } from './Chat';
import { useClickFlash } from '../hooks/useClickFlash';
import '../styles/settings.css';

interface SettingsPageProps {
  page: SettingsPageId;
  onClose: () => void;
}

const LANGUAGES = [
  { code: 'EN', name: 'English' },
  { code: 'KO', name: 'Korean' },
  { code: 'JP', name: 'Japanese' },
  { code: 'CN', name: 'Chinese' },
  { code: 'ES', name: 'Spanish' },
  { code: 'FR', name: 'French' },
  { code: 'DE', name: 'German' },
  { code: 'PT', name: 'Portuguese' },
  { code: 'IT', name: 'Italian' },
  { code: 'RU', name: 'Russian' },
  { code: 'AR', name: 'Arabic' },
  { code: 'HI', name: 'Hindi' },
  { code: 'TH', name: 'Thai' },
  { code: 'VI', name: 'Vietnamese' },
  { code: 'NL', name: 'Dutch' },
  { code: 'SV', name: 'Swedish' },
];

const SHORTCUT_LABELS = [
  'New session', 'Search', 'Close',
  'Next chat', 'Prev chat', 'Settings',
];

const MBTI_BADGES = ['I', 'N', 'T', 'J'];

const PAGE_TITLES: Record<SettingsPageId, string> = {
  shortcuts: 'Shortcuts',
  personalize: 'Personalize',
  language: 'Language',
  feedback: 'How did Winter do?',
};

function ShortcutsContent({ onFlash }: { onFlash: (e: React.MouseEvent<HTMLElement>) => void }) {
  return (
    <div className="settings-shortcuts-grid">
      {SHORTCUT_LABELS.map((label) => (
        <button key={label} className="settings-shortcut-card" onClick={onFlash}>
          <span className="settings-shortcut-label">{label}</span>
        </button>
      ))}
    </div>
  );
}

function PersonalizeContent({ onFlash }: { onFlash: (e: React.MouseEvent<HTMLElement>) => void }) {
  return (
    <div className="settings-personalize-cards">
      <button className="settings-card" onClick={onFlash}>
        <span className="settings-card-title">Apps</span>
        <span className="settings-card-subtitle">link your shit</span>
      </button>
      <button className="settings-card" onClick={onFlash}>
        <span className="settings-card-title settings-card-title-italic">Automation</span>
        <span className="settings-card-subtitle">Auto mate your errands</span>
      </button>
      <button className="settings-card" onClick={onFlash}>
        <div className="settings-card-row">
          <span className="settings-card-title">Winter is</span>
          <div className="settings-badges">
            {MBTI_BADGES.map((letter) => (
              <span key={letter} className="settings-badge">{letter}</span>
            ))}
          </div>
        </div>
        <span className="settings-card-subtitle">
          {'feeling lucky \u00b7 '}
          <span className="settings-card-link">something fun?</span>
        </span>
      </button>
    </div>
  );
}

function LanguageContent({ onFlash }: { onFlash: (e: React.MouseEvent<HTMLElement>) => void }) {
  return (
    <div className="settings-language-list">
      {LANGUAGES.map((lang) => (
        <button
          key={lang.code}
          className="settings-language-item"
          onClick={onFlash}
        >
          <span className="settings-language-code">{lang.code}</span>
          <span className="settings-language-name">{lang.name}</span>
        </button>
      ))}
    </div>
  );
}

function FeedbackContent({ onFlash }: { onFlash: (e: React.MouseEvent<HTMLElement>) => void }) {
  const [feedbackText, setFeedbackText] = useState('');

  return (
    <div className="settings-feedback">
      <textarea
        className="settings-textarea"
        placeholder="Tell us what you think..."
        value={feedbackText}
        onChange={(e) => setFeedbackText(e.target.value)}
      />
      <div className="settings-feedback-actions">
        <button className="settings-send-btn" onClick={onFlash}>
          send
        </button>
      </div>
    </div>
  );
}

export function SettingsPage({ page, onClose }: SettingsPageProps) {
  const onFlash = useClickFlash();

  const renderContent = () => {
    switch (page) {
      case 'shortcuts':
        return <ShortcutsContent onFlash={onFlash} />;
      case 'personalize':
        return <PersonalizeContent onFlash={onFlash} />;
      case 'language':
        return <LanguageContent onFlash={onFlash} />;
      case 'feedback':
        return <FeedbackContent onFlash={onFlash} />;
    }
  };

  return (
    <div className="settings-subpage" role="region" aria-label={PAGE_TITLES[page]}>
      <div className="settings-subpage-scroll">
        <div className="settings-subpage-inner">
          <h2 className="settings-subpage-title">{PAGE_TITLES[page]}</h2>

          {renderContent()}

          {page === 'personalize' && (
            <div className="settings-advanced-row">
              <button
                className="settings-advanced-btn"
                onClick={(e) => { onFlash(e); onClose(); }}
              >
                Advanced
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
