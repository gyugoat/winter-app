/**
 * AutomationPage — Service management + cron task management.
 *
 * Two collapsible sections: Services (systemd/launchd) and Cron Tasks.
 * Supports start/stop/restart for services, toggle/run-now/delete for tasks,
 * and inline form for creating new cron tasks.
 *
 * Tauri commands: get_services_status, get_scheduler_status, control_service,
 * toggle_task, run_task_now, delete_task, create_task.
 */
import { useState, useEffect, useRef } from 'react';
import { invoke } from '../../utils/invoke-shim';
import { useI18n } from '../../i18n';
import '../../styles/settings-automation.css';

interface ServiceStatusInfo {
  id: string;
  name: string;
  category: string;
  status: 'running' | 'stopped' | 'unknown' | 'notinstalled' | 'unsupported';
  supported: boolean;
}

interface TaskStatus {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  created_by_user: boolean;
  last_run?: string;
  next_run?: string;
  running: boolean;
}

interface CreateTaskForm {
  name: string;
  schedule: string;
  script: string;
}

interface AutomationPageProps {
  /** Click-flash ripple handler from useClickFlash */
  onFlash: (e: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Settings page for managing background services and scheduled cron tasks.
 *
 * @param onFlash - ripple effect callback on interactive element click
 */
export function AutomationPage({ onFlash }: AutomationPageProps) {
  const { t } = useI18n();
  const [services, setServices] = useState<ServiceStatusInfo[]>([]);
  const [tasks, setTasks] = useState<TaskStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(true);
  const [cronsOpen, setCronsOpen] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState<CreateTaskForm>({ name: '', schedule: '', script: '' });
  const [creating, setCreating] = useState(false);
  const fetchIdRef = useRef(0);

  const fetchStatus = async () => {
    const id = ++fetchIdRef.current;
    setLoading(true);
    setError(false);
    try {
      const [svcData, taskData] = await Promise.all([
        invoke<ServiceStatusInfo[]>('get_services_status'),
        invoke<TaskStatus[]>('get_scheduler_status'),
      ]);
      if (id === fetchIdRef.current) {
        setServices(svcData);
        setTasks(taskData);
      }
    } catch {
      if (id === fetchIdRef.current) setError(true);
    }
    if (id === fetchIdRef.current) setLoading(false);
  };

  useEffect(() => { fetchStatus(); }, []);

  const setBusy = (id: string, busy: boolean) => {
    setBusyIds(prev => {
      const next = new Set(prev);
      busy ? next.add(id) : next.delete(id);
      return next;
    });
  };

  const handleServiceToggle = async (e: React.MouseEvent<HTMLElement>, svc: ServiceStatusInfo) => {
    onFlash(e);
    if (busyIds.has(svc.id)) return;
    setBusy(svc.id, true);
    try {
      await invoke('control_service', { id: svc.id, action: svc.status === 'running' ? 'stop' : 'start' });
    } catch { setError(true); }
    try { await fetchStatus(); } catch { /* status refresh failed but action may have succeeded */ }
    setBusy(svc.id, false);
  };

  const handleServiceRestart = async (e: React.MouseEvent<HTMLElement>, svc: ServiceStatusInfo) => {
    onFlash(e);
    const key = `${svc.id}-restart`;
    if (busyIds.has(key)) return;
    setBusy(key, true);
    try {
      await invoke('control_service', { id: svc.id, action: 'restart' });
    } catch { setError(true); }
    try { await fetchStatus(); } catch { /* status refresh failed but action may have succeeded */ }
    setBusy(key, false);
  };

  const handleTaskToggle = async (e: React.MouseEvent<HTMLElement>, task: TaskStatus) => {
    onFlash(e);
    if (busyIds.has(task.id)) return;
    setBusy(task.id, true);
    try {
      await invoke('toggle_task', { id: task.id, enabled: !task.enabled });
    } catch { setError(true); }
    try { await fetchStatus(); } catch { /* status refresh failed but action may have succeeded */ }
    setBusy(task.id, false);
  };

  const handleRunNow = async (e: React.MouseEvent<HTMLElement>, task: TaskStatus) => {
    onFlash(e);
    const key = `${task.id}-run`;
    if (busyIds.has(key)) return;
    setBusy(key, true);
    try {
      await invoke('run_task_now', { id: task.id });
    } catch { setError(true); }
    setBusy(key, false);
  };

  const handleDeleteTask = async (e: React.MouseEvent<HTMLElement>, task: TaskStatus) => {
    onFlash(e);
    const key = `${task.id}-delete`;
    if (busyIds.has(key)) return;
    setBusy(key, true);
    try {
      await invoke('delete_task', { id: task.id });
      await fetchStatus();
    } catch { setError(true); }
    setBusy(key, false);
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim() || !createForm.schedule.trim() || !createForm.script.trim()) return;
    setCreating(true);
    try {
      const id = createForm.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      if (!id) return;
      await invoke('create_task', {
        entry: {
          id,
          name: createForm.name.trim(),
          schedule: createForm.schedule.trim(),
          command: { script: createForm.script.trim(), args: [] },
          log_file: `${id}.log`,
          enabled: false,
          created_by_user: true,
        },
      });
      setCreateForm({ name: '', schedule: '', script: '' });
      setShowCreateForm(false);
      await fetchStatus();
    } catch { setError(true); }
    setCreating(false);
  };

  const getServiceDotClass = (status: ServiceStatusInfo['status']) => {
    switch (status) {
      case 'running':      return 'settings-automation-status-dot active';
      case 'stopped':      return 'settings-automation-status-dot';
      case 'notinstalled': return 'settings-automation-status-dot notinstalled';
      default:             return 'settings-automation-status-dot unknown';
    }
  };

  const getServiceLabel = (svc: ServiceStatusInfo) => {
    switch (svc.status) {
      case 'running':      return t('automationRunning');
      case 'stopped':      return t('automationStopped');
      case 'notinstalled': return t('automationNotInstalled');
      default:             return t('automationStopped');
    }
  };

  const visibleServices = services.filter(s => s.supported !== false && s.status !== 'unsupported');

  if (loading) {
    return (
      <div className="settings-automation-state">
        <span className="settings-automation-state-text settings-automation-state-loading">{t('automationLoading')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="settings-automation-state">
        <span className="settings-automation-state-text settings-automation-state-error">{t('automationError')}</span>
        <button className="settings-automation-refresh-btn" onClick={(e) => { onFlash(e); fetchStatus(); }}>
          {t('automationRefresh')}
        </button>
      </div>
    );
  }

  return (
    <div className="settings-automation">
      {visibleServices.length > 0 && (
        <div className="settings-automation-section">
          <button
            className="settings-automation-section-header"
            onClick={(e) => { onFlash(e); setServicesOpen(!servicesOpen); }}
          >
            <span className={`settings-automation-section-chevron${servicesOpen ? ' open' : ''}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
            <span className="settings-automation-section-title">{t('automationServices')}</span>
            <span className="settings-automation-section-count">{visibleServices.length}</span>
          </button>
          {servicesOpen && (
            <div className="settings-card settings-automation-list">
              {visibleServices.map((svc, i) => (
                <div key={svc.id} className={`settings-automation-row${i < visibleServices.length - 1 ? ' settings-automation-row-divider' : ''}`}>
                  <span className={getServiceDotClass(svc.status)} />
                  <span className="settings-automation-name">{svc.name}</span>
                  <span className={`settings-automation-label${svc.status === 'running' ? ' running' : ''}`}>
                    {getServiceLabel(svc)}
                  </span>
                  <div className="settings-automation-actions">
                    <button
                      className="settings-automation-action-btn"
                      onClick={(e) => handleServiceRestart(e, svc)}
                      disabled={busyIds.has(`${svc.id}-restart`) || svc.status === 'notinstalled'}
                      title={t('automationRestart')}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                    </button>
                    <button
                      className="settings-automation-toggle-wrap"
                      onClick={(e) => handleServiceToggle(e, svc)}
                      disabled={busyIds.has(svc.id) || svc.status === 'notinstalled'}
                      aria-label={svc.status === 'running' ? t('automationRunning') : t('automationStopped')}
                    >
                      <span className={`settings-automation-toggle${svc.status === 'running' ? ' on' : ''}`}>
                        <span className="settings-automation-toggle-dot" />
                      </span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="settings-automation-section">
        <button
          className="settings-automation-section-header"
          onClick={(e) => { onFlash(e); setCronsOpen(!cronsOpen); }}
        >
          <span className={`settings-automation-section-chevron${cronsOpen ? ' open' : ''}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
          <span className="settings-automation-section-title">{t('automationCrons')}</span>
          <span className="settings-automation-section-count">{tasks.length}</span>
        </button>
        {cronsOpen && (
          <div className="settings-card settings-automation-list">
            {tasks.map((task, i) => (
              <div key={task.id} className={`settings-automation-row${i < tasks.length - 1 ? ' settings-automation-row-divider' : ''}`}>
                <span className="settings-automation-name">{task.name}</span>
                <span className="settings-automation-schedule">{task.schedule}</span>
                <div className="settings-automation-actions">
                  {task.created_by_user && (
                    <button
                      className="settings-automation-action-btn settings-automation-delete-btn"
                      onClick={(e) => handleDeleteTask(e, task)}
                      disabled={busyIds.has(`${task.id}-delete`)}
                      title={t('automationDeleteTask')}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4h6v2" />
                      </svg>
                    </button>
                  )}
                  <button
                    className="settings-automation-action-btn"
                    onClick={(e) => handleRunNow(e, task)}
                    disabled={busyIds.has(`${task.id}-run`) || task.running}
                    title={t('automationRunNow')}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  </button>
                  <button
                    className="settings-automation-toggle-wrap"
                    onClick={(e) => handleTaskToggle(e, task)}
                    disabled={busyIds.has(task.id)}
                    aria-label={task.enabled ? t('automationRunning') : t('automationStopped')}
                  >
                    <span className={`settings-automation-toggle${task.enabled ? ' on' : ''}`}>
                      <span className="settings-automation-toggle-dot" />
                    </span>
                  </button>
                </div>
              </div>
            ))}
            {showCreateForm ? (
              <form
                className="settings-automation-create-form"
                onSubmit={handleCreateTask}
              >
                <input
                  className="settings-automation-create-input"
                  type="text"
                  placeholder={t('automationTaskName')}
                  value={createForm.name}
                  onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                  autoFocus
                />
                <input
                  className="settings-automation-create-input"
                  type="text"
                  placeholder={t('automationTaskSchedule')}
                  value={createForm.schedule}
                  onChange={e => setCreateForm(f => ({ ...f, schedule: e.target.value }))}
                />
                <input
                  className="settings-automation-create-input"
                  type="text"
                  placeholder={t('automationTaskScript')}
                  value={createForm.script}
                  onChange={e => setCreateForm(f => ({ ...f, script: e.target.value }))}
                />
                <div className="settings-automation-create-actions">
                  <button
                    type="submit"
                    className="settings-automation-create-submit"
                    disabled={creating || !createForm.name.trim() || !createForm.schedule.trim() || !createForm.script.trim()}
                  >
                    {t('automationCreate')}
                  </button>
                  <button
                    type="button"
                    className="settings-automation-create-cancel"
                    onClick={() => { setShowCreateForm(false); setCreateForm({ name: '', schedule: '', script: '' }); }}
                  >
                    {t('automationCancel')}
                  </button>
                </div>
              </form>
            ) : (
              <div className={`settings-automation-row${tasks.length > 0 ? ' settings-automation-row-divider' : ''}`}>
                <button
                  className="settings-automation-create-btn"
                  onClick={(e) => { onFlash(e); setShowCreateForm(true); }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  {t('automationCreateTask')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <button
        className="settings-automation-refresh-btn"
        onClick={(e) => { onFlash(e); fetchStatus(); }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
        {t('automationRefresh')}
      </button>
    </div>
  );
}
