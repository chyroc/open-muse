export const TRIGGER_PATH: string;
export function triggerHeaders(
  secret: string,
  now?: number,
): Record<string, string>;
export function apiOrigin(value: string | undefined): string;
export function trigger(
  env: Record<string, string | undefined>,
  fetcher?: typeof fetch,
  now?: number,
): Promise<number>;
