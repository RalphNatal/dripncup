/** Minutes to wait before attempt n+1, after attempt n failed: 1, 5, 15, 60, then every 4 hours. */
const BACKOFF_MINUTES = [1, 5, 15, 60, 240];

export function retryDelayMinutes(attempts: number): number {
  return BACKOFF_MINUTES[Math.min(Math.max(attempts, 1), BACKOFF_MINUTES.length) - 1];
}
