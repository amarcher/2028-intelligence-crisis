// Shared types for Shipping Pulse ingestion. Kept in the Edge Function
// directory (not src/lib) so Deno imports cleanly without pulling React deps.

export interface ShippingSignalRow {
  source: string;
  metric: string;
  observed_at: string;   // ISO 8601
  value: number;
  unit: string;
  meta?: Record<string, unknown>;
}

export type SourceStatus = 'ok' | 'fail' | 'skipped';

export interface SourceHandler {
  name: string;
  cadence: 'daily' | 'weekly';
  // Return rows to upsert. Throw on hard failure (caught by orchestrator).
  // Throw a SkipSourceError to be logged as 'skipped' instead of 'fail'.
  fetch: () => Promise<ShippingSignalRow[]>;
}

export class SkipSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkipSourceError';
  }
}
