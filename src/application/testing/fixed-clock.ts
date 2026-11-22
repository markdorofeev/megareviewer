import type { Clock } from "../ports/index.ts";

/** Time moves only by `advance`, which also resolves the waits it passes. */
export class FixedClock implements Clock {
  private time: number;
  private waits: { readonly at: number; readonly resolve: () => void }[] = [];

  constructor(iso = "2026-01-01T00:00:00.000Z") {
    this.time = Date.parse(iso);
  }

  now(): string {
    return new Date(this.time).toISOString();
  }

  wait(ms: number): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    this.waits.push({ at: this.time + ms, resolve });
    return promise;
  }

  advance(ms: number): void {
    this.time += ms;
    const due = this.waits.filter((one) => one.at <= this.time);
    this.waits = this.waits.filter((one) => one.at > this.time);
    for (const one of due) one.resolve();
  }
}
