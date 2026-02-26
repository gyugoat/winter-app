/**
 * ShortcutsPage — Keyboard shortcuts reference grid.
 *
 * Displays a 3-column grid of shortcut cards, each showing
 * an action label and its key combination. Cards are purely
 * informational (flash animation on click for UX feedback).
 */
import { useI18n, type TranslationKey } from '../../i18n';
import '../../styles/settings-shortcuts.css';

/** Shortcut entry: i18n label key + key combination string */
const SHORTCUT_KEYS: { labelKey: TranslationKey; keys: string }[] = [
  { labelKey: 'shortcutNewSession',   keys: 'Ctrl + N' },
  { labelKey: 'shortcutArchive',      keys: 'Ctrl + Q' },
  { labelKey: 'shortcutFocusChat',    keys: 'Ctrl + Enter' },
  { labelKey: 'shortcutPrevSession',  keys: 'Ctrl + [' },
  { labelKey: 'shortcutNextSession',  keys: 'Ctrl + ]' },
  { labelKey: 'shortcutDeleteSession',keys: 'Ctrl + Shift + ⌫' },
  { labelKey: 'shortcutAttachFile',   keys: 'Ctrl + K' },
  { labelKey: 'shortcutAlwaysOnTop',  keys: 'Ctrl + P' },
  { labelKey: 'shortcutPrevMessage',  keys: 'Ctrl + ↑' },
  { labelKey: 'shortcutStopResponse', keys: 'Esc' },
  { labelKey: 'shortcutSearch',       keys: 'Ctrl + F' },
];

interface ShortcutsPageProps {
  /** Click-flash ripple handler from useClickFlash */
  onFlash: (e: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Renders the keyboard shortcuts grid page.
 *
 * @param onFlash - ripple effect callback on card click
 */
export function ShortcutsPage({ onFlash }: ShortcutsPageProps) {
  const { t } = useI18n();

  return (
    <div className="settings-shortcuts-grid">
      {SHORTCUT_KEYS.map((shortcut) => (
        <button
          key={shortcut.labelKey}
          className="settings-shortcut-card"
          onClick={onFlash}
        >
          <span className="settings-shortcut-label">{t(shortcut.labelKey)}</span>
          <span className="settings-shortcut-keys">{shortcut.keys}</span>
        </button>
      ))}
    </div>
  );
}
