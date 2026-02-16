import { useState, useCallback, useEffect, useRef } from 'react';
import { load } from '@tauri-apps/plugin-store';
import { Splash } from './components/Splash';
import { Readme } from './components/Readme';
import { Auth } from './components/Auth';
import { Chat } from './components/Chat';
import { Titlebar } from './components/Titlebar';
import { useAuth } from './hooks/useAuth';
import { useIdle } from './hooks/useIdle';
import './styles/global.css';

type AppPhase = 'splash' | 'readme' | 'auth' | 'chat';

const IDLE_TIMEOUT = 3 * 60 * 1000;

function App() {
  const { isAuthenticated, getAuthorizeUrl, exchangeCode, loading } = useAuth();
  const [phase, setPhase] = useState<AppPhase>('splash');
  const [returning, setReturning] = useState(false);
  const [readmeSeen, setReadmeSeen] = useState<boolean | null>(null);
  const [idle, wake] = useIdle(IDLE_TIMEOUT);
  const prevPhase = useRef<AppPhase>('splash');

  useEffect(() => {
    (async () => {
      try {
        const store = await load('settings.json');
        const seen = await store.get<boolean>('readme_seen');
        setReadmeSeen(!!seen);
      } catch {
        setReadmeSeen(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (idle && phase === 'chat') {
      prevPhase.current = 'chat';
      setReturning(true);
      setPhase('splash');
    }
  }, [idle, phase]);

  const goToNextAfterReadme = useCallback(() => {
    if (loading) {
      setPhase('auth');
    } else {
      setPhase(isAuthenticated ? 'chat' : 'auth');
    }
  }, [isAuthenticated, loading]);

  const handleSplashDone = useCallback(() => {
    wake();
    if (returning) {
      setReturning(false);
      setPhase(prevPhase.current);
    } else if (readmeSeen === false) {
      setPhase('readme');
    } else if (readmeSeen === true) {
      goToNextAfterReadme();
    }
  }, [readmeSeen, returning, wake, goToNextAfterReadme]);

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
    return <Splash onDone={handleSplashDone} returning={returning} />;
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

  return <Chat onReauth={() => setPhase('auth')} onShowReadme={handleShowReadme} />;
}

export default App;
