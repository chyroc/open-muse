import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent, Session, Goal, LibraryItem } from "../../shared/types";

interface Data {
  sessions: Session[];
  events: Record<string, AgentEvent[]>;
  goals?: Goal[];
  library?: LibraryItem[];
  owner?: string;
  selection?: { agent: string; environment_id: string };
  autoApprovals?: Record<
    string,
    { state: "sending" | "confirmed" | "failed"; event: AgentEvent }
  >;
}

export class Store {
  data: Data = { sessions: [], events: {} };
  private queue: Promise<void> = Promise.resolve();
  constructor(
    private directory: string,
    private namespace: string,
  ) {}
  async init() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      this.data = JSON.parse(
        await readFile(join(this.directory, `${this.namespace}.json`), "utf8"),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  save() {
    const snapshot = JSON.stringify(this.data);
    const target = join(this.directory, `${this.namespace}.json`);
    const next = this.queue
      .catch(() => {})
      .then(async () => {
        await writeFile(`${target}.tmp`, snapshot, { mode: 0o600 });
        await rename(`${target}.tmp`, target);
      });
    this.queue = next;
    return next;
  }
  get(id: string) {
    return this.data.sessions.find((session) => session.id === id);
  }
}
