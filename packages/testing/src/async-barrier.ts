export class AsyncBarrier {
  private arrived = 0;
  private readonly waiting: Array<() => void> = [];

  public constructor(private readonly parties: number) {}

  public async wait(): Promise<void> {
    this.arrived += 1;
    if (this.arrived === this.parties) {
      this.arrived = 0;
      for (const release of this.waiting.splice(0)) release();
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }
}
