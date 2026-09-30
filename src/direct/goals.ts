import { t } from "../../shared/i18n";
import { ApiError } from "../../shared/ark";
import { digest } from "../../shared/crypto";
import { parseGoals, serializeGoals } from "../../shared/goals";
import type { Goal } from "../../shared/types";
import type { DirectIdentity } from "./identity";
import { LocalDatabase } from "./storage";

// Cloud memory is shared with the assistant. Legacy device-local records stay
// intact; only explicit goal actions import them, after verified cloud readback.
export class DirectGoals {
  private pending = Promise.resolve();
  private serial<T>(action: () => Promise<T>): Promise<T> {
    const result = this.pending.then(async (): Promise<T> => {
      // Modern iOS WebKit coordinates read-modify-write across same-origin views.
      // This is not a cross-device lock; cloud content checks still apply.
      const locks = globalThis.navigator?.locks;
      return locks
        ? await locks.request(`open-muse-goals:${this.owner}`, action)
        : await action();
    });
    this.pending = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  constructor(
    private owner: string,
    private db: LocalDatabase,
    private identity: Pick<
      DirectIdentity,
      "goalsDocument" | "saveGoalsDocument"
    >,
  ) {}
  private async read() {
    const document = await this.identity.goalsDocument();
    const cloud = parseGoals(document.content);
    const imported =
      (await this.db.get<string[]>(`${this.owner}:goals:imported`)) ?? [];
    const legacy = (
      (await this.db.get<Goal[]>(`${this.owner}:goals`)) ?? []
    ).filter((goal) => !imported.includes(goal.id));
    const missing = legacy.filter(
      (goal) => !cloud.some((entry) => entry.id === goal.id),
    );
    const data = [...cloud, ...missing];
    // Validate legacy rows too; never discard unreadable personal data silently.
    serializeGoals(data);
    return {
      document,
      legacy,
      data,
      revision: digest(document.content + "\n" + JSON.stringify(missing)),
    };
  }
  async snapshot() {
    const { data, revision } = await this.read();
    return {
      data: data.sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      revision,
    };
  }
  private async save(
    state: Awaited<ReturnType<DirectGoals["read"]>>,
    data: Goal[],
  ) {
    const saved = await this.identity.saveGoalsDocument(
      serializeGoals(data),
      state.document.revision,
    );
    const verified = parseGoals(saved.content);
    await this.db.update<string[]>(`${this.owner}:goals:imported`, (old) => [
      ...new Set([
        ...(old ?? []),
        ...state.legacy
          .filter((goal) => verified.some((row) => row.id === goal.id))
          .map((goal) => goal.id),
      ]),
    ]);
    return verified;
  }
  prepare() {
    return this.serial(() => this.prepareOnce());
  }
  private async prepareOnce() {
    const state = await this.read();
    const cloudIds = new Set(
      parseGoals(state.document.content).map((goal) => goal.id),
    );
    if (
      !state.document.id ||
      state.legacy.some((goal) => !cloudIds.has(goal.id))
    )
      await this.save(state, state.data);
    else if (state.legacy.length)
      await this.db.update<string[]>(`${this.owner}:goals:imported`, (old) => [
        ...new Set([...(old ?? []), ...state.legacy.map((goal) => goal.id)]),
      ]);
  }
  create(goal: Goal) {
    return this.serial(() => this.createOnce(goal));
  }
  private async createOnce(goal: Goal) {
    const state = await this.read();
    if (state.data.some((entry) => entry.id === goal.id))
      throw new ApiError(409, t("Goal already exists."));
    await this.save(state, [goal, ...state.data]);
    return goal;
  }
  update(id: string, patch: Partial<Goal>, revision?: string) {
    return this.serial(() => this.updateOnce(id, patch, revision));
  }
  private async updateOnce(
    id: string,
    patch: Partial<Goal>,
    revision?: string,
  ) {
    const state = await this.read();
    if (revision !== undefined && revision !== state.revision)
      throw new ApiError(
        409,
        t(
          "Your goals changed. Refresh and review the latest progress before saving.",
        ),
      );
    const index = state.data.findIndex((goal) => goal.id === id);
    if (index < 0) throw new ApiError(404, t("Goal not found."));
    const updated = {
      ...state.data[index],
      ...patch,
      id,
      updated_at: new Date().toISOString(),
    };
    const data = state.data.map((goal, i) => (i === index ? updated : goal));
    await this.save(state, data);
    return updated;
  }
}
