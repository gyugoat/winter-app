import { useState, useCallback, useEffect, useRef } from 'react';
import { Splash } from './components/Splash';
import { Auth } from './components/Auth';
import { Chat } from './components/Chat';
import { Titlebar } from './components/Titlebar';
import { useAuth } from './hooks/useAuth';
import { useIdle } from './hooks/useIdle';
import './styles/global.css';

type AppPhase = 'splash' | 'auth' | 'chat';

const IDLE_TIMEOUT = 3 * 60 * 1000;

function App() {
  const { isAuthenticated, getAuthorizeUrl, exchangeCode, loading } = useAuth();
  const [phase, setPhase] = useState<AppPhase>('splash');
  const [returning, setReturning] = useState(false);
  const [idle, wake] = useIdle(IDLE_TIMEOUT);
  const prevPhase = useRef<AppPhase>('splash');

  useEffect(() => {
    if (idle && phase === 'chat') {
      prevPhase.current = 'chat';
      setReturning(true);
      setPhase('splash');
    }
  }, [idle, phase]);

  const handleSplashDone = useCallback(() => {
    wake();
    if (returning) {
      setReturning(false);
      setPhase(prevPhase.current);
    } else if (loading) {
      setPhase('auth');
    } else {
      setPhase(isAuthenticated ? 'chat' : 'auth');
    }
  }, [isAuthenticated, loading, returning, wake]);

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

  return <Chat onReauth={() => setPhase('auth')} />;
}

export default App;
