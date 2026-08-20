export type NumericKind =
  | 'amount'
  | 'marketKey'
  | 'quoteId'
  | 'orderRef'
  | 'route'
  | 'payoutOrderRef';

const PATTERNS: Readonly<Record<NumericKind, RegExp>> = Object.freeze({
  amount: /^[0-9]{1,18}$/u,
  marketKey: /^[A-Z0-9-]{1,16}:[A-Z0-9-]{1,16}$/u,
  quoteId:
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
  orderRef: /^XCHG:[0-9a-f-]{10,40}$/u,
  route: /^[A-Z]{2}:[A-Z]{3}$/u,
  payoutOrderRef: /^PO:TG:[0-9A-F]{8}$/u
});

export class NumericRenderError extends Error {
  public constructor(reason: string) {
    super(reason);
    this.name = 'NumericRenderError';
  }
}

export interface NumericValue {
  readonly kind: NumericKind;
  readonly value: string;
}

/**
 * Controlled numeric renderer: templates are frozen constants with
 * positional {n} placeholders, and every substituted value must match
 * a charset whitelist (digits, uppercase market keys, hex ids) —
 * anything else fails closed. The charset physically cannot form
 * markup injection, so command replies may show numbers without
 * opening an interpolation surface.
 */
export function renderNumeric(
  template: string,
  values: readonly NumericValue[]
): string {
  if (typeof template !== 'string' || template.includes('$')) {
    throw new NumericRenderError('TEMPLATE_INVALID');
  }
  let output = template;
  for (const [index, entry] of values.entries()) {
    const pattern = PATTERNS[entry.kind];
    if (
      pattern === undefined ||
      typeof entry.value !== 'string' ||
      !pattern.test(entry.value)
    ) {
      throw new NumericRenderError('VALUE_WHITELIST_REJECTED');
    }
    const placeholder = `{${index}}`;
    if (!template.includes(placeholder)) {
      throw new NumericRenderError('PLACEHOLDER_MISMATCH');
    }
    output = output.replace(placeholder, entry.value);
  }
  return output;
}

Object.freeze(renderNumeric.prototype);
