import type { InspirationContent } from "./inspiration";
import type { BackgroundConnectionStatus } from "./background-connection";

export type BackgroundPhase =
  | "queued"
  | "creating"
  | "ready"
  | "sending"
  | "running"
  | "complete"
  | "failed"
  | "needs_attention";
export interface BackgroundSchedule {
  enabled: boolean;
  timezone: string;
  local_time: string;
  next_run_at: number | null;
  revision: number;
}
export interface BackgroundRun {
  id: string;
  phase: BackgroundPhase;
  session_id: string | null;
  error: string | null;
  created_at: number;
  scheduled_for: number;
}
export interface BackgroundPost extends InspirationContent {
  id: string;
  sequence: number;
  session_id: string;
  event_id: string;
  created_at: number;
}
export interface BackgroundStatus {
  connected: true;
  owner: string;
  backgroundReady: boolean;
  credentialStorageReady?: boolean;
  connection?: BackgroundConnectionStatus;
  schedule: BackgroundSchedule;
}
