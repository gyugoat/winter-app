import { useState, useCallback, useEffect, useRef } from 'react';
import { isTauri } from './utils/platform';
import { loadWebStore } from './utils/web-store';
import { Splash } from './components/Splash';
import { Readme } from './components/Readme';
import { Auth } from './components/Auth';
import { Chat } from './components/Chat';
import { IdleScreen } from './components/IdleScreen';
import { Titlebar } from './components/Titlebar';
import { useAuth } from './hooks/useAuth';
import { useIdle } from './hooks/useIdle';
import './styles/global.css';

type AppPhase = 'splash' | 'readme' | 'auth' | 'chat';

const IDLE_TIMEOUT = 3 * 60 * 1000;

function App() {
  const { isAuthenticated, getAuthorizeUrl, exchangeCode, loading } = useAuth();
  const [phase, setPhase] = useState<AppPhase>('splash');
  const [readmeSeen, setReadmeSeen] = useState<boolean | null>(null);
  const [idle, wake] = useIdle(IDLE_TIMEOUT);
  const prevPhase = useRef<AppPhase>('splash');

  useEffect(() => {
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let store: { get<T>(key: string): Promise<T | null | undefined> };
        if (isTauri) {
          const { load } = await import('@tauri-apps/plugin-store');
          store = await load('settings.json');
        } else {
          store = await loadWebStore('settings.json');
        }
        const seen = await store.get<boolean>('readme_seen');
        setReadmeSeen(!!seen);
      } catch {
        setReadmeSeen(false);
      }
    })();
  }, []);

  const showIdle = idle && phase === 'chat';

  const goToNextAfterReadme = useCallback(() => {
    if (loading) {
      setPhase('auth');
    } else {
      setPhase(isAuthenticated ? 'chat' : 'auth');
    }
  }, [isAuthenticated, loading]);

  const handleSplashDone = useCallback(() => {
    wake();
    if (readmeSeen === false) {
      setPhase('readme');
    } else if (readmeSeen === true) {
      goToNextAfterReadme();
    }
  }, [readmeSeen, wake, goToNextAfterReadme]);

  const handleReadmeDone = useCallback(() => {
    setReadmeSeen(true);
    if (prevPhase.current === 'chat') {
      setPhase('chat');
    } else {
      goToNextAfterReadme();
    }
  }, [goToNextAfterReadme]);

  const handleShowReadme = useCallback(() => {
    prevPhase.current = 'chat';
    setPhase('readme');
  }, []);

  const handleExchangeCode = useCallback(
    async (code: string) => {
      await exchangeCode(code);
      setPhase('chat');
    },
    [exchangeCode]
  );

  if (phase === 'splash') {
    return <Splash onDone={handleSplashDone} />;
  }

  if (phase === 'readme') {
    return <Readme onDone={handleReadmeDone} />;
  }

  if (phase === 'auth') {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Titlebar />
        <Auth
          getAuthorizeUrl={getAuthorizeUrl}
          onExchangeCode={handleExchangeCode}
          onSkip={() => setPhase('chat')}
        />
      </div>
    );
  }

  return (
    <>
      <Chat onReauth={() => setPhase('auth')} onShowReadme={handleShowReadme} />
      {showIdle && <IdleScreen onWake={wake} />}
    </>
  );
}

export default App;
