/**
 * ArchivePage — Browsable archive of past chat sessions grouped by date.
 *
 * Two views: date list (calendar overview) → session detail (masonry grid).
 * Clicking a date animates a sparkle then shows that day's sessions.
 * Clicking a session navigates to it and closes the settings overlay.
 */
import { useState } from 'react';
import type { Session } from '../../types';
import { useI18n } from '../../i18n';
import '../../styles/archive.css';

interface ArchivePageProps {
  /** Click-flash ripple handler from useClickFlash */
  onFlash: (e: React.MouseEvent<HTMLElement>) => void;
  /** All available sessions to display in the archive */
  sessions: Session[];
  /** Called when the user selects a session to navigate to */
  onSwitchSession: (id: string) => void;
}

/**
 * Settings page showing an archive of past sessions, grouped by date.
 *
 * @param onFlash         - ripple effect callback
 * @param sessions        - list of all sessions to display
 * @param onSwitchSession - called with session id on session card click
 */
export function ArchivePage({
  onFlash,
  sessions,
  onSwitchSession,
}: ArchivePageProps) {
  const { t } = useI18n();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [sparkleId, setSparkleId] = useState<string | null>(null);

  const grouped = sessions.reduce<Record<string, Session[]>>((acc, session) => {
    const date = new Date(session.createdAt);
    const key = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(session);
    return acc;
  }, {});

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  const handleDateClick = (e: React.MouseEvent<HTMLElement>, date: string) => {
    onFlash(e);
    setSparkleId(date);
    setTimeout(() => {
      setSparkleId(null);
      setSelectedDate(date);
    }, 400);
  };

  if (selectedDate && grouped[selectedDate]) {
    const dateSessions = grouped[selectedDate];
    const half = Math.ceil(dateSessions.length / 2);
    const leftCol = dateSessions.slice(0, half);
    const rightCol = dateSessions.slice(half);

    return (
      <div className="archive-detail">
        <button
          className="archive-back-btn"
          onClick={(e) => { onFlash(e); setSelectedDate(null); }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {selectedDate}
        </button>
        <div className="archive-grid">
          <div className="archive-grid-col">
            {leftCol.map((session) => (
              <button
                key={session.id}
                className="archive-session-card"
                onClick={(e) => { onFlash(e); onSwitchSession(session.id); }}
              >
                <span className="archive-session-name">{session.name}</span>
                <span className="archive-session-preview">
                  {session.messages[0]?.content.slice(0, 80) || t('archiveEmptySession')}
                </span>
                <span className="archive-session-count">
                  {session.messages.length} {t('archiveMessages')}
                </span>
              </button>
            ))}
          </div>
          <div className="archive-grid-col">
            {rightCol.map((session) => (
              <button
                key={session.id}
                className="archive-session-card"
                onClick={(e) => { onFlash(e); onSwitchSession(session.id); }}
              >
                <span className="archive-session-name">{session.name}</span>
                <span className="archive-session-preview">
                  {session.messages[0]?.content.slice(0, 80) || t('archiveEmptySession')}
                </span>
                <span className="archive-session-count">
                  {session.messages.length} {t('archiveMessages')}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="archive-list">
      {sortedDates.length === 0 && (
        <div className="archive-empty">{t('archiveEmpty')}</div>
      )}
      {sortedDates.map((date) => (
        <button
          key={date}
          className={`archive-date-block${sparkleId === date ? ' archive-sparkle' : ''}`}
          onClick={(e) => handleDateClick(e, date)}
        >
          <span className="archive-date-label">{date}</span>
          <span className="archive-date-count">
            {grouped[date].length} {t('sessions').toLowerCase()}
          </span>
        </button>
      ))}
    </div>
  );
}
