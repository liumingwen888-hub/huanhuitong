import { FormEvent, useEffect, useState } from 'react';
import * as api from '../api/endpoints.js';

type Guarded = <T>(
  operation: (token: string) => Promise<T>
) => Promise<T>;

const TARGET_OPTIONS = [
  'market_configs',
  'provider_configs',
  'signer_policies',
  'config_versions'
] as const;

export function ConfigPage(props: {
  readonly fetchImpl: typeof fetch;
  readonly guarded: Guarded;
}): JSX.Element {
  const [targetTable, setTargetTable] = useState<string>(
    'market_configs'
  );
  const [targetKey, setTargetKey] = useState('');
  const [payloadText, setPayloadText] = useState('{}');
  const [drafts, setDrafts] = useState<api.ConfigDraft[]>([]);
  const [message, setMessage] = useState('');

  const reload = async (): Promise<void> => {
    try {
      const result = await props.guarded((token) =>
        api.listDrafts(props.fetchImpl, token)
      );
      setDrafts(result.items);
    } catch (cause) {
      setMessage(String(cause));
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setMessage('');
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(payloadText) as Record<string, unknown>;
    } catch {
      setMessage('payload 不是合法 JSON。');
      return;
    }
    try {
      await props.guarded((token) =>
        api.createDraft(props.fetchImpl, token, {
          targetTable,
          targetKey,
          payload
        })
      );
      setMessage('草稿已创建，等待复核。');
      setTargetKey('');
      setPayloadText('{}');
      await reload();
    } catch (cause) {
      setMessage(String(cause));
    }
  };

  const settle = async (
    draftId: string,
    action: 'publish' | 'reject'
  ): Promise<void> => {
    setMessage('');
    try {
      await props.guarded((token) =>
        api.settleDraft(props.fetchImpl, token, draftId, action)
      );
      setMessage(action === 'publish' ? '已发布。' : '已拒绝。');
      await reload();
    } catch (cause) {
      setMessage(String(cause));
    }
  };

  return (
    <section>
      <h2>配置发布</h2>
      {message !== '' && <p className="notice">{message}</p>}
      <form className="config-form" onSubmit={submit}>
        <h3>新建草稿</h3>
        <label>
          目标表
          <select
            value={targetTable}
            onChange={(event) => {
              setTargetTable(event.target.value);
            }}
          >
            {TARGET_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          目标键
          <input
            value={targetKey}
            onChange={(event) => {
              setTargetKey(event.target.value);
            }}
            placeholder="如 USDT-TRC20:USDT-ERC20 或 withdrawal.approval"
            required
          />
        </label>
        <label>
          payload（JSON）
          <textarea
            value={payloadText}
            onChange={(event) => {
              setPayloadText(event.target.value);
            }}
            rows={8}
          />
        </label>
        <button type="submit">创建草稿</button>
      </form>
      <h3>待复核草稿</h3>
      <table>
        <thead>
          <tr>
            <th>草稿</th>
            <th>目标</th>
            <th>发起人</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((draft) => (
            <tr key={draft.draftId}>
              <td>{draft.draftId}</td>
              <td>
                {draft.targetTable} / {draft.targetKey}
              </td>
              <td>{draft.makerAdminId.slice(0, 8)}…</td>
              <td>
                <button
                  type="button"
                  onClick={() => {
                    void settle(draft.draftId, 'publish');
                  }}
                >
                  发布
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void settle(draft.draftId, 'reject');
                  }}
                >
                  拒绝
                </button>
              </td>
            </tr>
          ))}
          {drafts.length === 0 && (
            <tr>
              <td colSpan={4}>暂无待复核草稿。</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
