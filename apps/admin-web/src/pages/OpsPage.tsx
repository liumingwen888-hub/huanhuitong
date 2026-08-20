import { useEffect, useState } from 'react';
import * as api from '../api/endpoints.js';

type Guarded = <T>(
  operation: (token: string) => Promise<T>
) => Promise<T>;

interface ReconDomain {
  readonly discrepancies: readonly { kind: string }[];
}

interface ReconReport {
  readonly ledger: ReconDomain;
  readonly exchange: ReconDomain;
  readonly payout: ReconDomain;
  readonly checkedAt: string;
}

export function OpsPage(props: {
  readonly fetchImpl: typeof fetch;
  readonly guarded: Guarded;
}): JSX.Element {
  const [report, setReport] = useState<ReconReport | null>(null);
  const [watch, setWatch] = useState<api.WatchItem[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const [recon, list] = await Promise.all([
          props.guarded((token) =>
            api.reconciliation(props.fetchImpl, token)
          ),
          props.guarded((token) =>
            api.watchlist(props.fetchImpl, token)
          )
        ]);
        setReport(recon as ReconReport);
        setWatch(list.items);
      } catch (cause) {
        setMessage(String(cause));
      }
    })();
  }, []);

  const domainCard = (
    name: string,
    domain: ReconDomain | undefined
  ): JSX.Element => {
    const count = domain?.discrepancies.length ?? 0;
    return (
      <div className={count === 0 ? 'card ok' : 'card bad'}>
        <h3>{name}</h3>
        <p>
          {count === 0
            ? '零差异'
            : `${count} 项差异待人工处置`}
        </p>
        {count > 0 && (
          <ul>
            {domain?.discrepancies.map((d, index) => (
              <li key={index}>{String(d.kind)}</li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <section>
      <h2>对账视图</h2>
      {message !== '' && <p className="notice">{message}</p>}
      {report !== null && (
        <>
          <div className="cards">
            {domainCard('账本内核', report.ledger)}
            {domainCard('换汇', report.exchange)}
            {domainCard('法币代付', report.payout)}
          </div>
          <p className="meta">
            检查时间：{new Date(report.checkedAt).toLocaleString('zh-CN')}
          </p>
        </>
      )}
      <h3>观察清单</h3>
      <table>
        <thead>
          <tr>
            <th>编号</th>
            <th>类别</th>
            <th>域</th>
            <th>金额</th>
            <th>状态</th>
            <th>时长（分钟）</th>
          </tr>
        </thead>
        <tbody>
          {watch.map((item) => (
            <tr key={item.itemId}>
              <td>{item.itemId}</td>
              <td>
                {item.kind === 'SETTLE_PENDING'
                  ? '待结算'
                  : item.kind === 'RELEASE_PENDING'
                    ? '待释放'
                    : '不确定'}
              </td>
              <td>{item.domain}</td>
              <td>{item.amount}</td>
              <td>{item.status}</td>
              <td>{item.ageMinutes}</td>
            </tr>
          ))}
          {watch.length === 0 && (
            <tr>
              <td colSpan={6}>暂无在途项。</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
