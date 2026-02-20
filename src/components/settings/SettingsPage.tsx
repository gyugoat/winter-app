/**
 * SettingsPage — Outer shell that routes to per-page sub-components.
 *
 * Owns: page title display, subpage scroll container, advanced button (personalize only).
 * Does NOT own any page-level state — each page component manages its own.
 *
 * Navigation: controlled externally via `page` prop and `onNavigate` callback.
 * The page title is derived from PAGE_TITLE_KEYS using the current locale.
 */
import { useClickFlash } from '../../hooks/useClickFlash';
import { useI18n, type TranslationKey } from '../../i18n';
import type { SettingsPageId } from '../Chat';
import type { Session } from '../../types';
import { ShortcutsPage }      from './ShortcutsPage';
import { PersonalizePage }    from './PersonalizePage';
import { LanguagePage }       from './LanguagePage';
import { FeedbackPage }       from './FeedbackPage';
import { OllamaPage }         from './OllamaPage';
import { FolderBrowserPage }  from './FolderBrowserPage';
import { AutomationPage }     from './AutomationPage';
import { ArchivePage }        from './ArchivePage';
import '../../styles/settings.css';

/** Maps each page ID to its i18n title key */
const PAGE_TITLE_KEYS: Record<SettingsPageId, TranslationKey> = {
  shortcuts:  'shortcuts',
  personalize: 'personalize',
  language:   'language',
  feedback:   'feedbackTitle',
  archive:    'archiveTitle',
  ollama:     'ollamaTitle',
  folder:     'folderTitle',
  automation: 'automationTitle',
};

interface SettingsPageProps {
  /** Which settings page to display */
  page: SettingsPageId;
  /** Close the settings overlay */
  onClose: () => void;
  /** Navigate to a different settings page */
  onNavigate?: (page: SettingsPageId) => void;
  /** All sessions (passed through to ArchivePage) */
  sessions?: Session[];
  /** Switch active session (passed through to ArchivePage) */
  onSwitchSession?: (id: string) => void;
  /** Current working directory (passed through to FolderBrowserPage) */
  workingDirectory?: string;
  /** Called when user selects a new directory (passed through to FolderBrowserPage) */
  onChangeDirectory?: (dir: string) => void;
}

/**
 * Outer shell for the settings overlay. Renders the correct sub-page based on `page` prop.
 *
 * @param page              - currently active settings page id
 * @param onClose           - close callback for the advanced button / archive nav
 * @param onNavigate        - navigate to another page within settings
 * @param sessions          - archive sessions list
 * @param onSwitchSession   - switch active session from archive
 * @param workingDirectory  - current workspace directory
 * @param onChangeDirectory - update workspace directory
 */
export function SettingsPage({
  page,
  onClose,
  onNavigate,
  sessions,
  onSwitchSession,
  workingDirectory,
  onChangeDirectory,
}: SettingsPageProps) {
  const onFlash = useClickFlash();
  const { t } = useI18n();

  const renderContent = () => {
    switch (page) {
      case 'shortcuts':
        return <ShortcutsPage onFlash={onFlash} />;
      case 'personalize':
        return <PersonalizePage onFlash={onFlash} onNavigate={onNavigate} />;
      case 'language':
        return <LanguagePage onFlash={onFlash} />;
      case 'feedback':
        return <FeedbackPage onFlash={onFlash} />;
      case 'ollama':
        return <OllamaPage onFlash={onFlash} />;
      case 'folder':
        return (
          <FolderBrowserPage
            onFlash={onFlash}
            workingDirectory={workingDirectory ?? ''}
            onChangeDirectory={onChangeDirectory ?? (() => {})}
          />
        );
      case 'archive':
        return (
          <ArchivePage
            onFlash={onFlash}
            sessions={sessions ?? []}
            onSwitchSession={(id) => {
              onSwitchSession?.(id);
              onClose();
            }}
          />
        );
      case 'automation':
        return <AutomationPage onFlash={onFlash} />;
    }
  };

  const pageTitle = t(PAGE_TITLE_KEYS[page]);

  return (
    <div className="settings-subpage" role="region" aria-label={pageTitle}>
      <div className="settings-subpage-scroll">
        <div className="settings-subpage-inner">
          <h2 className="settings-subpage-title">{pageTitle}</h2>

          {renderContent()}

          {page === 'personalize' && (
            <div className="settings-advanced-row">
              <button
                className="settings-advanced-btn"
                onClick={(e) => { onFlash(e); onClose(); }}
              >
                {t('advanced')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
