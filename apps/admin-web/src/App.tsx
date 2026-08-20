import {
  useCallback,
  useMemo,
  useState
} from 'react';
import {
  ApiClientError,
  shouldAutoLogout
} from './api/client.js';
import * as api from './api/endpoints.js';
import { LoginPage } from './pages/LoginPage.js';
import { ApprovalsPage } from './pages/ApprovalsPage.js';
import { OpsPage } from './pages/OpsPage.js';
import { AuditPage } from './pages/AuditPage.js';
import { ConfigPage } from './pages/ConfigPage.js';

type Tab = 'approvals' | 'ops' | 'audit' | 'config';

interface SessionState {
  readonly token: string;
  readonly expiresAt: string;
}

const TAB_LABELS: Readonly<Record<Tab, string>> = Object.freeze({
  approvals: '审批台',
  ops: '对账视图',
  audit: '审计查询',
  config: '配置发布'
});

export function App(): JSX.Element {
  const [session, setSession] = useState<SessionState | null>(null);
  const [tab, setTab] = useState<Tab>('approvals');
  const [notice, setNotice] = useState('');

  const fetchImpl = useMemo(() => {
    return window.fetch.bind(window);
  }, []);

  const handleAuthed = useCallback(
    (token: string, expiresAt: string) => {
      sessionStorage.setItem('adminToken', token);
      setSession({ token, expiresAt });
      setNotice('');
    },
    []
  );

  const handleLogout = useCallback(async () => {
    if (session !== null) {
      await api.logout(fetchImpl, session.token).catch(() => undefined);
    }
    sessionStorage.removeItem('adminToken');
    setSession(null);
  }, [fetchImpl, session]);

  const guarded = useCallback(
    <T,>(operation: (token: string) => Promise<T>): Promise<T> => {
      const token = sessionStorage.getItem('adminToken') ?? '';
      return operation(token).catch((error: unknown) => {
        if (
          error instanceof ApiClientError &&
          shouldAutoLogout(error)
        ) {
          sessionStorage.removeItem('adminToken');
          setSession(null);
          setNotice('会话已过期，请重新登录。');
        }
        throw error;
      });
    },
    []
  );

  if (session === null) {
    const stored = sessionStorage.getItem('adminToken');
    if (stored !== null && stored !== '') {
      return (
        <LoginPage
          fetchImpl={fetchImpl}
          onAuthenticated={handleAuthed}
          notice={notice}
          prefillToken={stored}
        />
      );
    }
    return (
      <LoginPage
        fetchImpl={fetchImpl}
        onAuthenticated={handleAuthed}
        notice={notice}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>换汇通 · 运营后台</h1>
        <nav className="tabs">
          {(Object.keys(TAB_LABELS) as Tab[]).map((key) => (
            <button
              key={key}
              type="button"
              className={tab === key ? 'tab active' : 'tab'}
              onClick={() => {
                setTab(key);
              }}
            >
              {TAB_LABELS[key]}
            </button>
          ))}
        </nav>
        <div className="session-info">
          <span>
            会话至{' '}
            {new Date(session.expiresAt).toLocaleTimeString('zh-CN')}
          </span>
          <button type="button" onClick={handleLogout}>
            登出
          </button>
        </div>
      </header>
      {notice !== '' && <div className="notice">{notice}</div>}
      <main>
        {tab === 'approvals' && (
          <ApprovalsPage fetchImpl={fetchImpl} guarded={guarded} />
        )}
        {tab === 'ops' && (
          <OpsPage fetchImpl={fetchImpl} guarded={guarded} />
        )}
        {tab === 'audit' && (
          <AuditPage fetchImpl={fetchImpl} guarded={guarded} />
        )}
        {tab === 'config' && (
          <ConfigPage fetchImpl={fetchImpl} guarded={guarded} />
        )}
      </main>
    </div>
  );
}
