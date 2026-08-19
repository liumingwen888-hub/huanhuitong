export interface OpenSecurityFlow {
  readonly sessionId: string;
  readonly phase: 'primary' | 'confirmation';
  readonly mode: 'setup' | 'authorize';
}

/**
 * Shared in-memory flow registry: the security command handler drives
 * digit collection and completion, while the withdrawal command
 * handler opens authorization flows with real binding values. Both
 * must observe the same flows, hence the explicit shared instance.
 */
export class SecurityFlowRegistry {
  readonly #flows = new Map<string, OpenSecurityFlow>();

  public get(externalUserId: string): OpenSecurityFlow | undefined {
    return this.#flows.get(externalUserId);
  }

  public set(externalUserId: string, flow: OpenSecurityFlow): void {
    this.#flows.set(externalUserId, flow);
  }

  public delete(externalUserId: string): void {
    this.#flows.delete(externalUserId);
  }
}

Object.freeze(SecurityFlowRegistry.prototype);
