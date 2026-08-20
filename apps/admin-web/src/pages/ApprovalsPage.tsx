import { FormEvent, useEffect, useState } from 'react';
import * as api from '../api/endpoints.js';

type Guarded = <T>(
  operation: (token: string) => Promise<T>
) => Promise<T>;

export function ApprovalsPage(props: {
  readonly fetchImpl: typeof fetch;
  readonly guarded: Guarded;
}): JSX.Element {
  const [items, setItems] = useState<api.ApprovalItem[]>([]);
  const [message, setMessage] = useState('');
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const reload = async (): Promise<void> => {
    try {
      const result = await props.guarded((token) =>
        api.pendingApprovals(props.fetchImpl, token)
      );
      setItems(result.items);
    } catch (cause) {
      setMessage(String(cause));
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const approve = async (withdrawalId: string): Promise<void> => {
    setMessage('');
    try {
      await props.guarded((token) =>
        api.decideWithdrawal(props.fetchImpl, token, withdrawalId, {
          decision: 'APPROVE'
        })
      );
      setMessage('已批准。');
      await reload();
    } catch (cause) {
      setMessage(String(cause));
    }
  };

  const resolve = async (payoutOrderId: string): Promise<void> => {
    setMessage('');
    try {
      await props.guarded((token) =>
        api.resolvePayout(props.fetchImpl, token, payoutOrderId)
      );
      setMessage('已触发供应商查询。');
      await reload();
    } catch (cause) {
      setMessage(String(cause));
    }
  };

  const submitReject = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (rejectTarget === null || reason === '') {
      return;
    }
    setMessage('');
    try {
      await props.guarded((token) =>
        api.decideWithdrawal(props.fetchImpl, token, rejectTarget, {
          decision: 'REJECT',
          reason
        })
      );
      setMessage('已拒绝。');
      setRejectTarget(null);
      setReason('');
      await reload();
    } catch (cause) {
      setMessage(String(cause));
    }
  };

  return (
    <section>
      <h2>待审清单</h2>
      {message !== '' && <p className="notice">{message}</p>}
      {rejectTarget !== null && (
        <form className="reject-form" onSubmit={submitReject}>
          <h3>拒绝 {rejectTarget}</h3>
          <label>
            原因（必填）
            <input
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
              required
            />
          </label>
          <button type="submit">确认拒绝</button>
          <button
            type="button"
            onClick={() => {
              setRejectTarget(null);
              setReason('');
            }}
          >
            取消
          </button>
        </form>
      )}
      <table>
        <thead>
          <tr>
            <th>编号</th>
            <th>类别</th>
            <th>用户</th>
            <th>金额</th>
            <th>资产/路线</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.itemId}>
              <td>{item.itemId}</td>
              <td>
                {item.kind === 'WITHDRAWAL_APPROVAL'
                  ? '提现审批'
                  : '代付待裁决'}
              </td>
              <td>{item.uid.slice(0, 8)}…</td>
              <td>{item.amount}</td>
              <td>{item.assetOrRoute}</td>
              <td>
                {item.kind === 'WITHDRAWAL_APPROVAL' && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void approve(
                          item.itemId.slice('WDL:'.length)
                        );
                      }}
                    >
                      批准
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRejectTarget(
                          item.itemId.slice('WDL:'.length)
                        );
                      }}
                    >
                      拒绝
                    </button>
                  </>
                )}
                {item.kind === 'PAYOUT_UNKNOWN' && (
                  <button
                    type="button"
                    onClick={() => {
                      void resolve(
                        item.itemId.slice('PO:'.length)
                      );
                    }}
                  >
                    触发查询
                  </button>
                )}
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={6}>暂无待审项。</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
