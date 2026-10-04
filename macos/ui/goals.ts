import { formatLocale, t } from "../../shared/i18n";
import type { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { DirectIdentity } from "../../src/direct/identity";
import { MA, MA_BASE_URL, directFetch } from "../../src/direct/transport";
import { ApiError, ArkClient } from "../../shared/ark";
import { digest, uuid } from "../../shared/crypto";
import {
  goalCategories,
  parseGoals,
  serializeGoals,
  type GoalCategory,
} from "../../shared/goals";
import { eventText, type AgentEvent, type Goal } from "../../shared/types";
import { macOwner } from "./owner";

const database = new LocalDatabase();
// Goals, Library and their local presentation share the client's scope.
export const goalOwner = macOwner;
export type GoalChatRun = {
  token: string;
  category: GoalCategory;
  title: string;
  prompt: string;
  event: string;
  phase:
    "preparing" | "creating" | "ready" | "sending" | "confirmed" | "failed";
  session?: string;
  error?: string;
};
export type GoalActivity = {
  id: string;
  title: string;
  summary?: string;
  at: string;
  observed?: boolean;
};
type Presentation = {
  subtitles: boolean;
  chats: GoalChatRun[];
  observed: Record<string, Goal>;
  activity: Record<string, GoalActivity[]>;
};
const empty = (): Presentation => ({
  subtitles: true,
  chats: [],
  observed: {},
  activity: {},
});
const active = (run: GoalChatRun) =>
  !["confirmed", "failed"].includes(run.phase);
const rejected = (error: unknown) =>
  error instanceof ApiError &&
  [400, 401, 403, 404, 413, 429].includes(error.status);
const validId = (id: string) => {
  if (!/^[\w-]{1,200}$/.test(id))
    throw new Error(
      t("The conversation result is unconfirmed. Refresh before continuing."),
    );
  return id;
};
const canonical = (goals: Goal[]) =>
  serializeGoals([...goals].sort((a, b) => a.id.localeCompare(b.id)));

export function goalDescendants(goals: Goal[], id: string) {
  const result = new Set([id]);
  let previous = 0;
  while (previous !== result.size) {
    previous = result.size;
    for (const goal of goals)
      if (goal.parent_id && result.has(goal.parent_id)) result.add(goal.id);
  }
  return result;
}
export function goalStatusChange(goals: Goal[], id: string, complete: boolean) {
  const target = goals.find((goal) => goal.id === id);
  if (!target)
    throw new Error(
      t("This goal no longer exists. Refresh before making changes."),
    );
  const affected = complete ? goalDescendants(goals, id) : new Set([id]);
  if (!complete) {
    let parent = target.parent_id;
    while (parent) {
      if (affected.has(parent))
        throw new Error(t("The goal hierarchy is invalid."));
      affected.add(parent);
      parent = goals.find((goal) => goal.id === parent)?.parent_id;
    }
  }
  const updated_at = new Date().toISOString();
  return goals.map((goal) =>
    affected.has(goal.id)
      ? {
          ...goal,
          status: complete ? ("completed" as const) : ("active" as const),
          updated_at,
        }
      : goal,
  );
}
export function macGoalStarter(category: GoalCategory) {
  return category === "custom"
    ? t("I want to start a goal about ")
    : t("I want to start a {category} goal", { category: t(category) });
}

export function goalChatTitle(category: GoalCategory) {
  return t("{category} goal", {
    category: t(goalCategories.find((item) => item.id === category)!.label),
  });
}
// The local journal keeps its original English text so IDs and existing records
// remain stable across language changes. Only presentation is localized.
export function goalActivityLabel(title: string) {
  const patterns: [RegExp, string][] = [
    [/^Renamed from “([\s\S]*)”$/, "Renamed from “{title}”"],
    [/^Step added: ([\s\S]*)$/, "Step added: {title}"],
    [/^Completed step: ([\s\S]*)$/, "Completed step: {title}"],
    [/^Reopened step: ([\s\S]*)$/, "Reopened step: {title}"],
    [/^Step renamed: ([\s\S]*)$/, "Step renamed: {title}"],
  ];
  for (const [pattern, message] of patterns) {
    const match = title.match(pattern);
    if (match) return t(message, { title: match[1] });
  }
  return t(title);
}
function observedChanges(previous: Goal, goal: Goal): string[] {
  const changes: string[] = [];
  if (previous.title !== goal.title)
    changes.push(`Renamed from “${previous.title}”`);
  if (previous.status !== goal.status)
    changes.push(
      goal.status === "completed"
        ? "Goal completed"
        : goal.status === "paused"
          ? "Goal paused"
          : "Goal reactivated",
    );
  if (previous.description !== goal.description)
    changes.push("Plan description updated");
  for (const step of goal.steps) {
    const before = previous.steps.find((old) => old.id === step.id);
    if (!before) changes.push(`Step added: ${step.title}`);
    else if (before.done !== step.done)
      changes.push(
        `${step.done ? "Completed" : "Reopened"} step: ${step.title}`,
      );
    else if (before.title !== step.title)
      changes.push(`Step renamed: ${step.title}`);
  }
  if (
    previous.steps.some(
      (step) => !goal.steps.some((current) => current.id === step.id),
    )
  )
    changes.push("Plan steps removed");
  return changes;
}

// Mac presentation and explicit goal transitions. The cloud document remains
// authoritative; the local journal contains only changes this Mac actually read.
export class MacGoals {
  private owner: string;
  private key: string;
  private identity?: DirectIdentity;
  private abort = new AbortController();
  private pending = Promise.resolve();
  constructor(
    private client: Client,
    private db = database,
    private fetcher: typeof fetch = directFetch,
  ) {
    this.owner = goalOwner(client);
    this.key = `${this.owner}:macos-goals:v1`;
  }
  dispose() {
    this.abort.abort();
  }
  private assertConnection() {
    this.abort.signal.throwIfAborted();
    if (
      !this.client.identity.value?.apiKey ||
      goalOwner(this.client) !== this.owner
    )
      throw new Error(
        t("The connection changed. Reopen Goals before continuing."),
      );
  }
  private async state() {
    return (await this.db.get<Presentation>(this.key)) ?? empty();
  }
  private update(fn: (state: Presentation) => void) {
    return this.db.update<Presentation>(this.key, (old) => {
      const state = old ?? empty();
      fn(state);
      return state;
    });
  }
  async labels() {
    const state = await this.state();
    return Object.fromEntries(
      state.chats
        .filter((run) => run.session)
        .map((run) => [run.session!, goalChatTitle(run.category)]),
    );
  }
  async snapshot() {
    this.abort.signal.throwIfAborted();
    if (goalOwner(this.client) !== this.owner)
      throw new Error(t("The connection changed. Reopen Goals to refresh."));
    const cloud = await this.client.goals();
    if (goalOwner(this.client) !== this.owner)
      throw new Error(t("The connection changed. Reopen Goals to refresh."));
    await this.update((state) => {
      const ids = new Set(cloud.data.map((goal) => goal.id));
      for (const id of Object.keys(state.observed))
        if (!ids.has(id)) delete state.observed[id];
      for (const id of Object.keys(state.activity))
        if (!ids.has(id)) delete state.activity[id];
      for (const goal of cloud.data) {
        const previous = state.observed[goal.id];
        const activity = state.activity[goal.id] ?? [];
        if (!previous)
          activity.push({
            id: `created:${goal.id}`,
            title: "Goal saved",
            at: goal.created_at,
          });
        else
          for (const title of observedChanges(previous, goal)) {
            const id = digest(
              JSON.stringify([goal.id, goal.updated_at, title]),
            );
            if (!activity.some((entry) => entry.id === id))
              activity.push({ id, title, at: goal.updated_at, observed: true });
          }
        state.activity[goal.id] = activity.slice(-200);
        state.observed[goal.id] = goal;
      }
    });
    return { ...cloud, ...(await this.state()) };
  }
  async subtitles(value: boolean) {
    await this.update((state) => {
      state.subtitles = value;
    });
  }
  private memory() {
    this.assertConnection();
    const credentials = this.client.identity.value!;
    return (this.identity ??= new DirectIdentity(
      this.owner,
      new ArkClient(
        {
          arkBaseUrl: MA_BASE_URL,
          provider: MA,
          arkKey: credentials.apiKey ?? "",
          project: credentials.project ?? "",
        },
        async (input, init) => {
          this.assertConnection();
          return this.fetcher(input, init);
        },
        this.abort.signal,
      ),
      this.db,
    ));
  }
  async mutate(revision: string, change: (goals: Goal[]) => Goal[]) {
    this.assertConnection();
    const before = await this.client.goals();
    this.assertConnection();
    if (before.revision !== revision)
      throw new Error(
        t(
          "Your goals changed. Refresh and review the latest progress before saving.",
        ),
      );
    const desired = change(before.data);
    serializeGoals(desired);
    // Explicit goal actions may import legacy records through the shared service.
    // Verify its read-back before editing; never resurrect removed legacy goals.
    await this.client.prepareGoals();
    this.assertConnection();
    const save = async () => {
      this.assertConnection();
      const identity = this.memory();
      const document = await identity.goalsDocument();
      this.assertConnection();
      if (canonical(parseGoals(document.content)) !== canonical(before.data))
        throw new Error(
          t("Your goals changed during preparation. Refresh before saving."),
        );
      await identity.saveGoalsDocument(
        serializeGoals(desired),
        document.revision,
      );
      this.assertConnection();
      return this.snapshot();
    };
    // prepareGoals uses this same lock; acquire it only after preparation finishes.
    const result = this.pending.then(async () =>
      globalThis.navigator?.locks
        ? await navigator.locks.request(`open-muse-goals:${this.owner}`, save)
        : await save(),
    );
    this.pending = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  setCompleted(id: string, complete: boolean, revision: string) {
    return this.mutate(revision, (goals) =>
      goalStatusChange(goals, id, complete),
    );
  }
  remove(id: string, revision: string) {
    return this.mutate(revision, (goals) => {
      if (!goals.some((goal) => goal.id === id))
        throw new Error(t("This goal no longer exists."));
      const ids = goalDescendants(goals, id);
      return goals.filter((goal) => !ids.has(goal.id));
    });
  }
  async refresh() {
    if (this.client.signedIn()) {
      this.assertConnection();
      const state = await this.state();
      for (const run of state.chats.filter(active)) {
        if (run.phase === "creating") {
          const matches = (await this.client.sessions()).data.filter(
            (session) => session.title === run.token,
          );
          this.assertConnection();
          if (matches.length === 1)
            await this.patch(run.token, {
              session: validId(matches[0].id),
              phase: "ready",
              error: undefined,
            });
        } else if (run.phase === "sending" && run.session) {
          const events = await this.client.events(run.session);
          this.assertConnection();
          if (
            events.some(
              (event) =>
                event.id === run.event &&
                event.type === "user.message" &&
                eventText(event) === run.prompt,
            )
          )
            await this.patch(run.token, {
              phase: "confirmed",
              error: undefined,
            });
        }
      }
    }
    return this.snapshot();
  }
  private patch(token: string, patch: Partial<GoalChatRun>) {
    return this.update((state) => {
      const run = state.chats.find((run) => run.token === token);
      if (!run)
        throw new Error(
          t("The goal conversation changed. Refresh to continue."),
        );
      if (run.phase === "confirmed" || run.phase === "failed") return;
      Object.assign(run, patch);
    });
  }
  async start(
    category: GoalCategory,
    onSession: (id: string) => Promise<void>,
  ) {
    this.assertConnection();
    if (category === "custom")
      throw new Error(
        t("Custom goals begin with a draft, not an automatic send."),
      );
    const previous = (await this.state()).chats.find(active);
    await this.refresh();
    this.assertConnection();
    if (previous) {
      const reconciled = (await this.state()).chats.find(
        (run) => run.token === previous.token,
      );
      if (reconciled?.phase === "confirmed") {
        await onSession(reconciled.session!);
        return;
      }
    }
    let run = (await this.state()).chats.find(active);
    if (run && run.category !== category)
      throw new Error(
        t(
          "A previous goal conversation is unfinished. Continue it or refresh its history before starting another.",
        ),
      );
    if (!run) {
      run = {
        token: `open-muse-goal-${uuid()}`,
        category,
        title: `${category.charAt(0).toUpperCase() + category.slice(1)} goal`,
        prompt: macGoalStarter(category),
        event: `evt-${uuid()}`,
        phase: "preparing",
      };
      const fresh = run;
      await this.update((state) => {
        if (state.chats.some(active))
          throw new Error(
            t("Another window is starting a goal. Refresh to continue."),
          );
        state.chats.unshift(fresh);
      });
    }
    const token = run.token;
    if (run.phase === "preparing") {
      await this.client.prepareWorkspace();
      this.assertConnection();
      await this.client.prepareGoals();
      this.assertConnection();
      await this.update((state) => {
        const current = state.chats.find((run) => run.token === token);
        if (current?.phase !== "preparing")
          throw new Error(
            t("Another window is preparing this goal. Refresh to continue."),
          );
        current.phase = "creating";
      });
      try {
        this.assertConnection();
        const session = await this.client.create(token, "life");
        await this.patch(token, {
          session: validId(session.id),
          phase: "ready",
        });
      } catch (error) {
        if (rejected(error))
          await this.patch(token, {
            phase: "failed",
            error: (error as Error).message,
          });
        throw error;
      }
      run = (await this.state()).chats.find((run) => run.token === token)!;
    }
    if (run.phase === "creating" || run.phase === "sending")
      throw new Error(
        t(
          "Goal submission is unconfirmed. Refresh checks history; no request will be repeated.",
        ),
      );
    if (run.phase === "confirmed") {
      await onSession(run.session!);
      return;
    }
    if (run.phase !== "ready" || !run.session) return;
    await onSession(run.session);
    this.assertConnection();
    await this.update((state) => {
      const current = state.chats.find((run) => run.token === token);
      if (current?.phase !== "ready")
        throw new Error(
          t("Another window submitted this goal. Refresh to see it."),
        );
      current.phase = "sending";
    });
    const event: AgentEvent = {
      id: run.event,
      type: "user.message",
      content: [{ type: "text", text: run.prompt }],
    };
    try {
      await this.client.ma("SendSessionEvents", {
        params: { session_id: run.session },
        body: { events: [event] },
        confirm: true,
      });
      await this.patch(token, { phase: "confirmed", error: undefined });
    } catch (error) {
      await this.patch(token, {
        ...(rejected(error) ? { phase: "failed" as const } : {}),
        error: (error as Error).message,
      });
      throw error;
    }
  }
}
export type MacGoalsSnapshot = Awaited<ReturnType<MacGoals["snapshot"]>>;

const goalTime = (goal: Goal) => {
  for (const value of [goal.updated_at, goal.created_at]) {
    const time = Date.parse(value);
    if (!Number.isNaN(time)) return time;
  }
  return -Infinity;
};
// Most recently changed first; equal times keep a stable order by ID.
export function sortGoalsByRecency(goals: Goal[]) {
  return [...goals].sort(
    (a, b) => goalTime(b) - goalTime(a) || a.id.localeCompare(b.id),
  );
}
const startOfDay = (time: number) => new Date(time).setHours(0, 0, 0, 0);
// "Today", "Yesterday", or a short calendar date in the app language.
export function goalDayLabel(time: number, now = Date.now()) {
  const day = startOfDay(time);
  const today = startOfDay(now);
  if (day === today) return t("Today");
  if (day === startOfDay(today - 86_400_000)) return t("Yesterday");
  const date = new Date(time);
  return date.toLocaleDateString(formatLocale(), {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === new Date(now).getFullYear()
      ? {}
      : { year: "numeric" }),
  });
}
// Completed goals grouped by the month they last changed, newest first.
export function completedGoalGroups(goals: Goal[]) {
  const groups = new Map<string, { time: number; goals: Goal[] }>();
  for (const goal of sortGoalsByRecency(goals)) {
    const time = goalTime(goal);
    const date = new Date(time);
    const key = Number.isFinite(time)
      ? `${date.getFullYear()}-${date.getMonth()}`
      : "undated";
    const group = groups.get(key) ?? { time, goals: [] };
    group.goals.push(goal);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => ({
    key,
    label: Number.isFinite(group.time)
      ? new Date(group.time).toLocaleDateString(formatLocale(), {
          month: "long",
          year: "numeric",
        })
      : "—",
    goals: group.goals,
  }));
}
