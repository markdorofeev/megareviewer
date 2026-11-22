export interface Clock {
  /** ISO-8601 in UTC. */
  now(): string;
  /** Resolves once `ms` have passed; never keeps the process alive on its own. */
  wait(ms: number): Promise<void>;
}
