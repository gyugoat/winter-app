/**
 * MobileLinkCard — Collapsible card with QR code + Tailscale setup wizard.
 *
 * Extracted from PersonalizePage. Self-contained: manages its own expanded/wizard state.
 * Three wizard steps: (1) install Tailscale on desktop, (2) install on phone, (3) scan QR.
 */
import { useState, useCallback } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import QRCode from 'qrcode';
import { invoke } from '@tauri-apps/api/core';
import { useEffect } from 'react';
import { useI18n } from '../../i18n';
import '../../styles/settings-personalize.css';

const MOBILE_LINK_URL = 'http://100.120.53.89:8890/winter-mobile.html';

const TAILSCALE_DOWNLOAD_URLS: Record<string, string> = {
  windows: 'https://tailscale.com/download/windows',
  mac: 'https://tailscale.com/download/mac',
  linux: 'https://tailscale.com/download/linux',
};

function detectOS(): { name: string; key: 'windows' | 'mac' | 'linux' } {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return { name: 'Windows', key: 'windows' };
  if (ua.includes('mac')) return { name: 'macOS', key: 'mac' };
  return { name: 'Linux', key: 'linux' };
}

function useTailscaleConnected(): boolean {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const ok = await invoke<boolean>('check_tailscale');
        if (!cancelled) setConnected(ok);
      } catch {
        if (!cancelled) setConnected(false);
      }
    };

    check();
    const interval = setInterval(check, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  return connected;
}

interface MobileLinkCardProps {
  /** Click-flash ripple handler from useClickFlash */
  onFlash: (e: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Collapsible card that walks the user through connecting their mobile device
 * via Tailscale and a QR code link to the Winter mobile interface.
 *
 * @param onFlash - ripple effect callback on interactive element click
 */
export function MobileLinkCard({ onFlash }: MobileLinkCardProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [phoneQrDataUrl, setPhoneQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);

  const os = detectOS();
  const tailscaleConnected = useTailscaleConnected();

  const generateQr = useCallback(async () => {
    try {
      const url = await QRCode.toDataURL(MOBILE_LINK_URL, {
        width: 200,
        margin: 2,
        color: { dark: '#e5e5e5', light: '#13111f' },
      });
      setQrDataUrl(url);
    } catch {}
  }, []);

  const generatePhoneQr = useCallback(async () => {
    try {
      const url = await QRCode.toDataURL('https://tailscale.com/download', {
        width: 180,
        margin: 2,
        color: { dark: '#e5e5e5', light: '#13111f' },
      });
      setPhoneQrDataUrl(url);
    } catch {}
  }, []);

  const handleToggle = (e: React.MouseEvent<HTMLElement>) => {
    onFlash(e);
    const next = !expanded;
    setExpanded(next);
    if (next) {
      if (!qrDataUrl) generateQr();
      setWizardStep(0);
    }
  };

  const handleCopy = async (e: React.MouseEvent<HTMLElement>) => {
    onFlash(e);
    try {
      await navigator.clipboard.writeText(MOBILE_LINK_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleStartGuide = (e: React.MouseEvent<HTMLElement>) => {
    onFlash(e);
    setWizardStep(1);
  };

  const handleNext = (e: React.MouseEvent<HTMLElement>) => {
    onFlash(e);
    const next = wizardStep + 1;
    setWizardStep(next);
    if (next === 2 && !phoneQrDataUrl) generatePhoneQr();
  };

  const handlePrev = (e: React.MouseEvent<HTMLElement>) => {
    onFlash(e);
    setWizardStep(wizardStep - 1);
  };

  const handleBackToHome = (e: React.MouseEvent<HTMLElement>) => {
    onFlash(e);
    setWizardStep(0);
  };

  return (
    <div className="settings-card settings-mobile-link-card">
      <button className="settings-mobile-link-header" onClick={handleToggle}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="5" y="2" width="14" height="20" rx="3" />
          <line x1="12" y1="18" x2="12" y2="18.01" />
        </svg>
        <span className="settings-card-title">{t('mobileLink')}</span>
        <span className={`settings-mobile-link-chevron${expanded ? ' open' : ''}`}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      {expanded && (
        <div className="settings-mobile-link-body">
          {wizardStep === 0 && (
            <div className="settings-mobile-link-wizard-step" key="step0">
              <span className="settings-card-subtitle">{t('mobileLinkSubtitle')}</span>
              <div className="settings-mobile-link-url-row">
                <input
                  className="settings-mobile-link-url"
                  value={MOBILE_LINK_URL}
                  readOnly
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button className="settings-mobile-link-copy" onClick={handleCopy}>
                  {copied ? t('copied') : t('copy')}
                </button>
              </div>
              {qrDataUrl && (
                <div className="settings-mobile-link-qr">
                  <img src={qrDataUrl} alt="QR" width={160} height={160} />
                  <span className="settings-mobile-link-qr-hint-light">{t('mobileLinkQrHint')}</span>
                </div>
              )}
              <button className="settings-mobile-link-wizard-start-btn" onClick={handleStartGuide}>
                {t('mobileLinkGuideStart')}
              </button>
            </div>
          )}

          {wizardStep >= 1 && wizardStep <= 3 && (
            <div className="settings-mobile-link-wizard-container" key={`step${wizardStep}`}>
              <div className="settings-mobile-link-wizard-progress">
                {[1, 2, 3].map((dot) => (
                  <span
                    key={dot}
                    className={`settings-mobile-link-wizard-dot${wizardStep === dot ? ' active' : wizardStep > dot ? ' done' : ''}`}
                  />
                ))}
              </div>

              {wizardStep === 1 && (
                <div className="settings-mobile-link-wizard-step">
                  <h4 className="settings-mobile-link-wizard-title">{t('mobileLinkStep1Title')}</h4>
                  {tailscaleConnected ? (
                    <div className="settings-mobile-link-wizard-connected">
                      <span className="settings-mobile-link-wizard-badge-green">{t('mobileLinkStep1Connected')}</span>
                      <p className="settings-mobile-link-wizard-hint">{t('mobileLinkStep1Ready')}</p>
                    </div>
                  ) : (
                    <div className="settings-mobile-link-wizard-install-row">
                      <span className="settings-mobile-link-wizard-badge-muted">{t('mobileLinkStep1NotInstalled')}</span>
                      <p className="settings-mobile-link-wizard-hint">
                        {t('mobileLinkDetectedOS')}: <strong>{os.name}</strong>
                      </p>
                      <button
                        className="settings-mobile-link-wizard-dl-btn"
                        onClick={() => openUrl(TAILSCALE_DOWNLOAD_URLS[os.key])}
                      >
                        {t('mobileLinkStep1Download')}
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '5px' }}>
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                      </button>
                      <p className="settings-mobile-link-wizard-note">{t('mobileLinkStep1AfterInstall')}</p>
                    </div>
                  )}
                  <div className="settings-mobile-link-wizard-nav">
                    <button className="settings-mobile-link-wizard-btn-ghost" onClick={handleBackToHome}>{t('mobileLinkPrev')}</button>
                    <button className="settings-mobile-link-wizard-btn-primary" onClick={handleNext}>{t('mobileLinkDone')}</button>
                  </div>
                </div>
              )}

              {wizardStep === 2 && (
                <div className="settings-mobile-link-wizard-step">
                  <h4 className="settings-mobile-link-wizard-title">{t('mobileLinkStep2Title')}</h4>
                  {phoneQrDataUrl && (
                    <div className="settings-mobile-link-wizard-qr-wrap">
                      <img src={phoneQrDataUrl} alt="Tailscale download QR" width={140} height={140} />
                    </div>
                  )}
                  <p className="settings-mobile-link-wizard-hint">{t('mobileLinkStep2Desc')}</p>
                  <p className="settings-mobile-link-wizard-note">{t('mobileLinkStep2SameAccount')}</p>
                  <div className="settings-mobile-link-wizard-nav">
                    <button className="settings-mobile-link-wizard-btn-ghost" onClick={handlePrev}>{t('mobileLinkPrev')}</button>
                    <button className="settings-mobile-link-wizard-btn-primary" onClick={handleNext}>{t('mobileLinkDone')}</button>
                  </div>
                </div>
              )}

              {wizardStep === 3 && (
                <div className="settings-mobile-link-wizard-step">
                  <div className="settings-mobile-link-wizard-success">
                    <span className="settings-mobile-link-wizard-checkmark">✓</span>
                  </div>
                  <h4 className="settings-mobile-link-wizard-title">{t('mobileLinkStep3Title')}</h4>
                  {qrDataUrl && (
                    <div className="settings-mobile-link-wizard-qr-wrap">
                      <img src={qrDataUrl} alt="Winter QR" width={140} height={140} />
                    </div>
                  )}
                  <p className="settings-mobile-link-wizard-hint">{t('mobileLinkStep3Desc')}</p>
                  <div className="settings-mobile-link-url-row" style={{ marginTop: '4px' }}>
                    <input
                      className="settings-mobile-link-url"
                      value={MOBILE_LINK_URL}
                      readOnly
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <button className="settings-mobile-link-copy" onClick={handleCopy}>
                      {copied ? t('copied') : t('copy')}
                    </button>
                  </div>
                  <p className="settings-mobile-link-wizard-note">{t('mobileLinkStep3HomeScreen')}</p>
                  <div className="settings-mobile-link-wizard-nav">
                    <button className="settings-mobile-link-wizard-btn-ghost" onClick={handlePrev}>{t('mobileLinkPrev')}</button>
                    <button className="settings-mobile-link-wizard-btn-primary" onClick={handleBackToHome}>{t('mobileLinkNext')}</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
