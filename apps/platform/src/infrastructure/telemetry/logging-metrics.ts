import type {
  HistogramName,
  MetricAttributes,
  MetricName,
  MetricsPort
} from '@xht/contracts';

interface CounterEntry {
  readonly name: MetricName;
  readonly attributes: MetricAttributes | undefined;
  count: number;
}

interface HistogramEntry {
  readonly name: HistogramName;
  readonly attributes: MetricAttributes | undefined;
  count: number;
  sum: number;
  min: number;
  max: number;
}

export interface MetricsFlushRow {
  readonly kind: 'counter' | 'histogram';
  readonly name: string;
  readonly attributes: MetricAttributes | undefined;
  readonly values: Readonly<Record<string, number>>;
}

function sameAttributes(
  a: MetricAttributes | undefined,
  b: MetricAttributes | undefined
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Log-flushing metrics implementation: counters and histograms
 * accumulate in memory and flush as structured rows — the minimum
 * observable baseline without any OTLP dependency. Production swaps
 * the same MetricsPort interface for the OTel Metrics API.
 */
export class LoggingMetrics implements MetricsPort {
  readonly #counters: CounterEntry[] = [];
  readonly #histograms: HistogramEntry[] = [];

  public incrementCounter(
    name: MetricName,
    attributes?: MetricAttributes
  ): void {
    const existing = this.#counters.find(
      (entry) =>
        entry.name === name &&
        sameAttributes(entry.attributes, attributes)
    );
    if (existing !== undefined) {
      existing.count += 1;
      return;
    }
    this.#counters.push({ name, attributes, count: 1 });
  }

  public recordHistogram(
    name: HistogramName,
    valueMs: number,
    attributes?: MetricAttributes
  ): void {
    const existing = this.#histograms.find(
      (entry) =>
        entry.name === name &&
        sameAttributes(entry.attributes, attributes)
    );
    if (existing !== undefined) {
      existing.count += 1;
      existing.sum += valueMs;
      existing.min = Math.min(existing.min, valueMs);
      existing.max = Math.max(existing.max, valueMs);
      return;
    }
    this.#histograms.push({
      name,
      attributes,
      count: 1,
      sum: valueMs,
      min: valueMs,
      max: valueMs
    });
  }

  /** Snapshot and reset — callers emit rows to their log sink. */
  public flush(): readonly MetricsFlushRow[] {
    const rows: MetricsFlushRow[] = [
      ...this.#counters.map((entry) => ({
        kind: 'counter' as const,
        name: entry.name,
        attributes: entry.attributes,
        values: { count: entry.count }
      })),
      ...this.#histograms.map((entry) => ({
        kind: 'histogram' as const,
        name: entry.name,
        attributes: entry.attributes,
        values: {
          count: entry.count,
          sum: entry.sum,
          min: entry.min,
          max: entry.max
        }
      }))
    ];
    this.#counters.length = 0;
    this.#histograms.length = 0;
    return Object.freeze(rows);
  }
}

Object.freeze(LoggingMetrics.prototype);
