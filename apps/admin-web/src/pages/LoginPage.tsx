import { FormEvent, useState } from 'react';
import * as api from '../api/endpoints.js';

export function LoginPage(props: {
  readonly fetchImpl: typeof fetch;
  readonly onAuthenticated: (token: string, expiresAt: string) => void;
  readonly notice?: string;
  readonly prefillToken?: string;
}): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api.login(props.fetchImpl, {
        username,
        password,
        totpCode
      });
      props.onAuthenticated(result.token, result.expiresAt);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '登录失败'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>换汇通 · 运营后台</h1>
        {props.notice !== undefined && props.notice !== '' && (
          <p className="notice">{props.notice}</p>
        )}
        <label>
          用户名
          <input
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
            }}
            autoComplete="username"
            required
          />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            autoComplete="current-password"
            required
          />
        </label>
        <label>
          动态验证码（TOTP）
          <input
            value={totpCode}
            onChange={(event) => {
              setTotpCode(event.target.value);
            }}
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            required
          />
        </label>
        {error !== '' && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  );
}
