import { FormEvent, useEffect, useState } from 'react';
import * as api from '../api/endpoints.js';
import { nextPageQuery } from '../api/client.js';

type Guarded = <T>(
  operation: (token: string) => Promise<T>
) => Promise<T>;

const CATEGORY_OPTIONS = [
  '',
  'ADMIN_API_',
  'WITHDRAWAL_',
  'EXCHANGE_',
  'PAYOUT_',
  'SECURITY_',
  'IDENTITY_'
] as const;

export function AuditPage(props: {
  readonly fetchImpl: typeof fetch;
  readonly guarded: Guarded;
}): JSX.Element {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [actor, setActor] = useState('');
  const [category, setCategory] = useState('');
  const [items, setItems] = useState<api.AuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const buildQuery = (): Record<string, string> => {
    const query: Record<string, string> = {};
    if (from !== '') {
      query.from = from;
    }
    if (to !== '') {
      query.to = to;
    }
    if (actor !== '') {
      query.actor = actor;
    }
    if (category !== '') {
      query.category = category;
    }
    return query;
  };

  const search = async (
    query: Record<string, string>
  ): Promise<void> => {
    setMessage('');
    try {
      const result = await props.guarded((token) =>
        api.auditEvents(props.fetchImpl, token, query)
      );
      setItems(result.items);
      setNextCursor(result.nextCursor);
    } catch (cause) {
      setMessage(String(cause));
    }
  };

  useEffect(() => {
    void search({});
  }, []);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void search(buildQuery());
  };

  const next = (): void => {
    const query = nextPageQuery(buildQuery(), nextCursor);
    if (query !== null) {
      void search(query);
    }
  };

  return (
    <section>
      <h2>审计查询</h2>
      {message !== '' && <p className="notice">{message}</p>}
      <form className="filter-form" onSubmit={submit}>
        <label>
          起
          <input
            type="datetime-local"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
            }}
          />
        </label>
        <label>
          止
          <input
            type="datetime-local"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
            }}
          />
        </label>
        <label>
          主体
          <input
            value={actor}
            onChange={(event) => {
              setActor(event.target.value);
            }}
            placeholder="admin id 或 anonymous"
          />
        </label>
        <label>
          类别
          <select
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
            }}
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === '' ? '全部' : option}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">查询</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>事件</th>
            <th>主体</th>
            <th>对象</th>
            <th>结果</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.auditEventId}>
              <td>
                {new Date(item.occurredAt).toLocaleString('zh-CN')}
              </td>
              <td>{item.eventType}</td>
              <td>{item.actorRef.slice(0, 8)}…</td>
              <td>{item.subjectRef}</td>
              <td>{item.outcome}</td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={5}>无匹配事件。</td>
            </tr>
          )}
        </tbody>
      </table>
      {nextCursor !== null && (
        <button type="button" onClick={next}>
          下一页
        </button>
      )}
    </section>
  );
}
