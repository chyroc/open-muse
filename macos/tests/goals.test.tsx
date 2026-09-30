import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "../../src/api";
import { LocalDatabase } from "../../src/direct/storage";
import { defaultIdentity, DirectIdentity } from "../../src/direct/identity";
import { DirectGoals } from "../../src/direct/goals";
import { ARK_BASE_URL } from "../../src/direct/transport";
import { ApiError, ArkClient } from "../../shared/ark";
import { parseGoals, serializeGoals } from "../../shared/goals";
import {
  eventText,
  type AgentEvent,
  type Goal,
  type Session,
} from "../../shared/types";
import { GoalsPage } from "../ui/GoalsPage";
import { DesktopApp } from "../ui/DesktopApp";
import { WorkspaceBoundary } from "../ui/WorkspaceBoundary";
import {
  MacGoals,
  goalDescendants,
  goalOwner,
  goalStatusChange,
  goalActivityLabel,
  goalChatTitle,
} from "../ui/goals";

vi.mock("../../src/useTask", () => ({
  useTask: () => ({
    events: [],
    session: undefined,
    loading: false,
    error: "",
    connected: false,
    autoApprovalFailures: [],
    refresh: async () => {},
  }),
}));
const goal = (id = "root", parent_id?: string): Goal => ({
  id,
  title: `Goal ${id}`,
  description: "A personal plan.",
  category: "health",
  parent_id,
  status: "active",
  steps: [{ id: "step", title: "First step", done: false }],
  created_at: "2026-09-30T09:00:00Z",
  updated_at: "2026-09-30T09:00:00Z",
});
function fixture(initial: Goal[] = []) {
  const database = new LocalDatabase(`mac-goals-test-${crypto.randomUUID()}`);
  const documents = new Map<
    string,
    { id: string; path: string; content: string }
  >();
  for (const document of Object.values(defaultIdentity().documents))
    documents.set(document.name, {
      id: document.name.replace(".", "-"),
      path: `/${document.name}`,
      content: document.content,
    });
  documents.set("GOALS.md", {
    id: "goals",
    path: "/GOALS.md",
    content: serializeGoals(initial),
  });
  const sessions: Session[] = [],
    histories = new Map<string, AgentEvent[]>();
  const identity = {
    value: { apiKey: `test-${crypto.randomUUID()}`, project: "test" },
  };
  const owner = goalOwner({ identity } as unknown as Client);
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname.replace("/api/v3", "");
    let value: unknown;
    if (path === "/memory_stores")
      value = {
        data: [{ id: "store", metadata: { open_muse_identity: owner } }],
      };
    else if (path === "/memory_stores/store")
      value = { id: "store", metadata: { open_muse_identity: owner } };
    else if (path === "/memory_stores/store/memories")
      value = { data: [...documents.values()] };
    else {
      const document = [...documents.values()].find((document) =>
        path.endsWith(`/${document.id}`),
      );
      if (!document) throw new Error(`Unexpected test request: ${path}`);
      if (init?.method === "POST")
        document.content = JSON.parse(String(init.body)).content;
      value = document;
    }
    return new Response(JSON.stringify(value), { status: 200 });
  });
  const memory = new DirectIdentity(
    owner,
    new ArkClient(
      {
        arkBaseUrl: ARK_BASE_URL,
        arkKey: identity.value.apiKey,
        project: "test",
      },
      fetcher,
    ),
    database,
  );
  const goals = new DirectGoals(owner, database, memory);
  const stub = {
    identity,
    signedIn: () => true,
    goals: vi.fn(() => goals.snapshot()),
    prepareGoals: vi.fn(() => goals.prepare()),
    updateGoal: vi.fn((id: string, patch: Partial<Goal>, revision?: string) =>
      goals.update(id, patch, revision),
    ),
    prepareWorkspace: vi.fn(async () => {}),
    sessions: vi.fn(async () => ({ data: sessions })),
    events: vi.fn(async (id: string) => histories.get(id) ?? []),
    create: vi.fn(async (title: string) => {
      const session = {
        id: `session-${sessions.length}`,
        title,
        status: "idle",
      } as Session;
      sessions.push(session);
      return session;
    }),
    ma: vi.fn(
      async (
        _operation: string,
        input: {
          params: { session_id: string };
          body: { events: AgentEvent[] };
          confirm: boolean;
        },
      ) => {
        histories.set(input.params.session_id, input.body.events);
        return { data: input.body.events };
      },
    ),
    config: vi.fn(async () => ({ mode: "ark" })),
    companionIdentity: vi.fn(async () => defaultIdentity()),
    conversationIndex: vi.fn(async () => ({ mainId: "main", entries: {} })),
    openConversation: vi.fn(async () => ({ id: "main", status: "idle" })),
    send: vi.fn(
      async (_id: string, _input: { type: string; text: string }) => ({
        data: [],
      }),
    ),
  };
  const client = stub as unknown as Client;
  return {
    client,
    stub,
    database,
    documents,
    fetcher,
    sessions,
    histories,
    service: () => new MacGoals(client, database, fetcher),
    cloud: () => parseGoals(documents.get("GOALS.md")!.content),
    replace: (rows: Goal[]) => {
      documents.get("GOALS.md")!.content = serializeGoals(rows);
    },
  };
}
describe("Mac Goals adapter", () => {
  it("completes descendants and reactivates ancestors without changing unrelated plans", () => {
    const rows = [
      goal(),
      goal("child", "root"),
      goal("leaf", "child"),
      goal("other"),
    ];
    expect([...goalDescendants(rows, "root")]).toEqual([
      "root",
      "child",
      "leaf",
    ]);
    const completed = goalStatusChange(rows, "root", true);
    expect(completed.map((row) => row.status)).toEqual([
      "completed",
      "completed",
      "completed",
      "active",
    ]);
    expect(
      goalStatusChange(completed, "leaf", false).map((row) => row.status),
    ).toEqual(["active", "active", "active", "active"]);
    expect(() => goalStatusChange(rows, "missing", true)).toThrow(
      "no longer exists",
    );
  });
  it("reads only, journals observed changes, prunes deleted content and isolates projects", async () => {
    const f = fixture([goal()]);
    const service = f.service();
    expect((await service.refresh()).activity.root).toHaveLength(1);
    f.replace([
      {
        ...goal(),
        title: "A clearer name",
        updated_at: "2026-09-30T10:00:00Z",
      },
    ]);
    expect((await service.refresh()).activity.root[1].title).toContain(
      "Renamed",
    );
    expect((await service.refresh()).activity.root).toHaveLength(2);
    await service.subtitles(false);
    expect((await f.service().snapshot()).subtitles).toBe(false);
    f.replace([]);
    expect((await service.snapshot()).activity).toEqual({});
    expect((await service.snapshot()).observed).toEqual({});
    f.stub.identity.value.project = "other";
    expect((await f.service().snapshot()).subtitles).toBe(true);
    expect(f.stub.prepareGoals).not.toHaveBeenCalled();
    expect(f.stub.create).not.toHaveBeenCalled();
    expect(f.stub.ma).not.toHaveBeenCalled();
    expect(
      f.fetcher.mock.calls.every(([, init]) => init?.method !== "POST"),
    ).toBe(true);
  });
  it("rejects stale revisions before preparing or writing", async () => {
    const f = fixture([goal()]);
    await expect(
      f.service().setCompleted("root", true, "stale"),
    ).rejects.toThrow("changed");
    expect(f.stub.prepareGoals).not.toHaveBeenCalled();
    expect(
      f.fetcher.mock.calls.every(([, init]) => init?.method !== "POST"),
    ).toBe(true);
  });
  it("saves completion and subtree deletion through verified MA memory", async () => {
    const f = fixture([goal(), goal("child", "root"), goal("other")]);
    const service = f.service();
    const completed = await service.setCompleted(
      "root",
      true,
      (await service.snapshot()).revision,
    );
    expect(f.cloud().map((row) => row.status)).toEqual([
      "completed",
      "completed",
      "active",
    ]);
    await service.remove("root", completed.revision);
    expect(f.cloud().map((row) => row.id)).toEqual(["other"]);
    expect((await service.snapshot()).activity.root).toBeUndefined();
    expect(f.stub.send).not.toHaveBeenCalled();
    expect(f.stub.ma).not.toHaveBeenCalled();
  });
  it("does not overwrite a plan changed during preparation", async () => {
    const f = fixture([goal()]);
    const service = f.service();
    const revision = (await service.snapshot()).revision;
    f.stub.prepareGoals.mockImplementationOnce(async () => {
      f.replace([{ ...goal(), title: "Changed elsewhere" }]);
    });
    await expect(service.remove("root", revision)).rejects.toThrow(
      "during preparation",
    );
    expect(f.cloud()[0].title).toBe("Changed elsewhere");
    expect(
      f.fetcher.mock.calls.every(([, init]) => init?.method !== "POST"),
    ).toBe(true);
  });
  it("never repeats an ambiguous memory update and confirms applied writes by reading", async () => {
    const f = fixture([goal()]);
    const real = f.fetcher.getMockImplementation()!;
    let lose = true;
    f.fetcher.mockImplementation(async (input, init) => {
      const result = await real(input, init);
      if (lose && init?.method === "POST") {
        lose = false;
        throw new Error("Lost write response");
      }
      return result;
    });
    const service = f.service();
    const revision = (await service.snapshot()).revision;
    await expect(service.setCompleted("root", true, revision)).rejects.toThrow(
      "Lost write",
    );
    await expect(service.setCompleted("root", true, revision)).rejects.toThrow(
      "changed",
    );
    expect((await service.refresh()).data[0].status).toBe("completed");
    expect(
      f.fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
  });
  it("uses dedicated category conversations and exact starter messages", async () => {
    const f = fixture();
    const open = vi.fn(async (_id: string) => {});
    await f.service().start("health", open);
    expect(f.stub.create).toHaveBeenCalledOnce();
    expect(f.stub.openConversation).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith("session-0");
    expect(f.stub.ma.mock.calls[0][0]).toBe("SendSessionEvents");
    expect(eventText(f.stub.ma.mock.calls[0][1].body.events[0])).toBe(
      "I want to start a health goal",
    );
    expect((await f.service().labels())["session-0"]).toBe("Health goal");
    await expect(f.service().start("custom", open)).rejects.toThrow("draft");
  });
  it("recovers a lost create by exact unique token without recreating", async () => {
    const f = fixture();
    const open = vi.fn(async (_id: string) => {});
    let title = "";
    f.stub.create.mockImplementationOnce(async (token) => {
      title = token;
      throw new Error("Lost create response");
    });
    await expect(f.service().start("health", open)).rejects.toThrow(
      "Lost create",
    );
    f.sessions.push({ id: "similar", title: `${title}-other` } as Session);
    await expect(f.service().start("health", open)).rejects.toThrow(
      "unconfirmed",
    );
    f.sessions.push({ id: "recovered", title } as Session);
    await f.service().start("health", open);
    expect(f.stub.create).toHaveBeenCalledTimes(1);
    expect(f.stub.ma.mock.calls[0][1].params.session_id).toBe("recovered");
  });
  it("does not create a duplicate when recovery confirms a lost send", async () => {
    const f = fixture();
    const open = vi.fn(async (_id: string) => {});
    f.stub.ma.mockImplementationOnce(async (_operation, input) => {
      f.histories.set(input.params.session_id, input.body.events);
      throw new Error("Lost send response");
    });
    await expect(f.service().start("health", open)).rejects.toThrow(
      "Lost send",
    );
    await f.service().start("health", open);
    expect(f.stub.create).toHaveBeenCalledOnce();
    expect(f.stub.ma).toHaveBeenCalledOnce();
    expect(open).toHaveBeenLastCalledWith("session-0");
    expect((await f.service().snapshot()).chats[0].phase).toBe("confirmed");
  });
  it("requires stable event ID and exact text to confirm a lost send", async () => {
    const f = fixture();
    const open = vi.fn(async (_id: string) => {});
    f.stub.ma.mockRejectedValueOnce(new Error("Lost send"));
    await expect(f.service().start("health", open)).rejects.toThrow();
    const run = (await f.service().snapshot()).chats[0];
    f.histories.set(run.session!, [
      {
        id: "similar",
        type: "user.message",
        content: [{ type: "text", text: run.prompt }],
      },
    ]);
    await expect(f.service().start("health", open)).rejects.toThrow(
      "unconfirmed",
    );
    f.histories.set(run.session!, [
      {
        id: run.event,
        type: "user.message",
        content: [{ type: "text", text: "different" }],
      },
    ]);
    await expect(f.service().start("health", open)).rejects.toThrow(
      "unconfirmed",
    );
    expect(f.stub.ma).toHaveBeenCalledOnce();
  });
  it("retains a ready session when navigation fails and prevents concurrent sends", async () => {
    const f = fixture();
    await expect(
      f.service().start("career", async () => {
        throw new Error("Workspace changed");
      }),
    ).rejects.toThrow("Workspace");
    expect(f.stub.ma).not.toHaveBeenCalled();
    const results = await Promise.allSettled([
      f.service().start("career", async () => {}),
      f.service().start("career", async () => {}),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(f.stub.create).toHaveBeenCalledOnce();
    expect(f.stub.ma).toHaveBeenCalledOnce();
  });
  it("allows explicit retry after definite rejection but rejects account changes", async () => {
    const f = fixture();
    const open = vi.fn(async (_id: string) => {});
    f.stub.ma.mockRejectedValueOnce(new ApiError(429, "Rate limited"));
    await expect(f.service().start("finance", open)).rejects.toThrow(
      "Rate limited",
    );
    await f.service().start("finance", open);
    expect(f.stub.ma).toHaveBeenCalledTimes(2);
    const service = f.service();
    f.stub.identity.value.project = "another";
    await expect(service.start("career", open)).rejects.toThrow(
      "connection changed",
    );
  });
  it("stops before preparing goal memory if the account changes during workspace setup", async () => {
    const f = fixture();
    f.stub.prepareWorkspace.mockImplementationOnce(async () => {
      f.stub.identity.value.project = "changed";
    });
    await expect(f.service().start("health", async () => {})).rejects.toThrow(
      "connection changed",
    );
    expect(f.stub.prepareGoals).not.toHaveBeenCalled();
    expect(f.stub.create).not.toHaveBeenCalled();
    expect(f.stub.ma).not.toHaveBeenCalled();
  });
  it("shares the goals lock without holding it during legacy preparation", async () => {
    const f = fixture([goal()]);
    const requests: string[] = [];
    let held = false;
    const locks = {
      request: async (name: string, callback: () => Promise<unknown>) => {
        if (held) throw new Error("Nested goals lock");
        held = true;
        requests.push(name);
        try {
          return await callback();
        } finally {
          held = false;
        }
      },
    };
    vi.stubGlobal("navigator", { ...navigator, locks });
    const service = f.service();
    await service.setCompleted(
      "root",
      true,
      (await service.snapshot()).revision,
    );
    expect(requests).toEqual([
      `open-muse-goals:${goalOwner(f.client)}`,
      `open-muse-goals:${goalOwner(f.client)}`,
    ]);
    expect(f.cloud()[0].status).toBe("completed");
  });
  it("keeps the shared pending-write guard after an unapplied lost response", async () => {
    const f = fixture([goal()]);
    const original = f.fetcher.getMockImplementation()!;
    f.fetcher.mockImplementation(async (input, init) => {
      if (init?.method === "POST") throw new Error("Lost response");
      return original(input, init);
    });
    const service = f.service(),
      revision = (await service.snapshot()).revision;
    await expect(service.setCompleted("root", true, revision)).rejects.toThrow(
      "Lost response",
    );
    await expect(
      f.service().setCompleted("root", true, revision),
    ).rejects.toThrow("unconfirmed");
    expect(
      f.fetcher.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(1);
    expect(f.cloud()[0].status).toBe("active");
  });
});
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
  location.hash = "";
  vi.unstubAllGlobals();
});
async function mount(element: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(element));
  await settle();
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}
function button(label: string) {
  const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) =>
      button.textContent === label ||
      button.getAttribute("aria-label") === label,
  );
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
async function click(label: string) {
  await act(async () => button(label).click());
  await settle();
}
async function type(value: string, selector = "input") {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(
      selector === "textarea"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function page(f: ReturnType<typeof fixture>, selectedId?: string) {
  vi.stubGlobal("fetch", f.fetcher);
  const props = {
    client: f.client,
    selectedId,
    split: false,
    onToggleChat: vi.fn(),
    onSelect: vi.fn(),
    onConversation: vi.fn(async (_id: string) => {}),
    onDraft: vi.fn(),
    onOpenChat: vi.fn(),
    onConnect: vi.fn(),
    onEditorChange: vi.fn(),
  };
  return { props, element: <GoalsPage {...props} /> };
}
describe("Mac Goals desktop UI", () => {
  it("keeps a failed lazy workspace recoverable without performing any request", async () => {
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    function Broken() {
      throw new Error("Missing native bundle chunk");
      return null;
    }
    try {
      await mount(
        <div>
          <nav>Navigation stays available</nav>
          <WorkspaceBoundary>
            <Broken />
          </WorkspaceBoundary>
        </div>,
      );
      expect(host.textContent).toContain("Navigation stays available");
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        "Could not open your workspace",
      );
      expect(button("Try again")).toBeDefined();
    } finally {
      report.mockRestore();
    }
  });
  it.each(["en", "zh-CN", "fr-FR"])(
    "uses system language %s without translating personal goal content",
    async (language) => {
      vi.stubGlobal("__OPEN_MUSE_LANGUAGES__", [language]);
      const f = fixture([
        {
          ...goal(),
          title: "Health 我的原始标题",
          description: "Keep original personal plan.",
        },
      ]);
      await mount(page(f, "root").element);
      expect(host.textContent).toContain("Health 我的原始标题");
      expect(host.textContent).toContain("Keep original personal plan.");
      expect(host.textContent).toContain(
        language === "zh-CN" ? "目标已保存" : "Goal saved",
      );
      expect(goalActivityLabel("Renamed from “Keep original name”")).toContain(
        "Keep original name",
      );
      expect(goalActivityLabel("Step added: User step")).toContain("User step");
      expect(goalChatTitle("health")).toBe(
        language === "zh-CN" ? "健康目标" : "Health goal",
      );
    },
  );
  it("renders empty categories and intro without creating or sending", async () => {
    const f = fixture();
    const p = page(f);
    await mount(p.element);
    for (const label of [
      "Health",
      "Relationships",
      "Finance",
      "Career",
      "Interests",
      "Productivity",
      "Something else",
    ])
      expect(button(label)).toBeDefined();
    expect(host.querySelector('[aria-label="Goals options"]')).toBeNull();
    await click("Health");
    expect(host.querySelector("dialog")?.textContent).toContain(
      "Create a health goal",
    );
    await click("Close Create a health goal");
    expect(f.stub.create).not.toHaveBeenCalled();
    expect(f.stub.ma).not.toHaveBeenCalled();
  });
  it("confirms Something else then seeds a draft without writing", async () => {
    const f = fixture();
    const p = page(f);
    await mount(p.element);
    await click("Something else");
    expect(p.props.onDraft).not.toHaveBeenCalled();
    await click("Let's do it");
    expect(p.props.onDraft).toHaveBeenCalledWith(
      "I want to start a goal about ",
    );
    expect(f.stub.prepareGoals).not.toHaveBeenCalled();
    expect(f.stub.create).not.toHaveBeenCalled();
    expect(f.stub.ma).not.toHaveBeenCalled();
  });
  it("opens normal categories in dedicated side conversations and guards double clicks", async () => {
    const f = fixture();
    const p = page(f);
    await mount(p.element);
    await click("Career");
    await act(async () => {
      const start = button("Let's do it");
      start.click();
      start.click();
    });
    await settle();
    expect(p.props.onConversation).toHaveBeenCalledWith("session-0");
    expect(f.stub.create).toHaveBeenCalledOnce();
    expect(f.stub.ma).toHaveBeenCalledOnce();
  });
  it("renders desktop detail, plan steps, observed activity and subgoal drafts", async () => {
    const f = fixture([goal(), goal("child", "root")]);
    const p = page(f, "root");
    await mount(p.element);
    expect(host.querySelector(".goal-detail-dialog")?.textContent).toContain(
      "First step",
    );
    expect(
      host.querySelector('[aria-label="Goal activity timeline"]')?.textContent,
    ).toContain("Goal saved");
    await click("Add subgoal");
    expect(p.props.onDraft).toHaveBeenCalledWith(
      'I want to create a sub-goal under "Goal root" about ',
      expect.objectContaining({ id: "root" }),
    );
    expect(f.stub.create).not.toHaveBeenCalled();
    expect(f.stub.ma).not.toHaveBeenCalled();
  });
  it("preserves rename drafts after conflicts and requires explicit latest-version adoption", async () => {
    const f = fixture([goal()]);
    const p = page(f);
    await mount(p.element);
    await click("Rename");
    await type("My revised goal", "#goal-name");
    f.replace([{ ...goal(), title: "New cloud name" }]);
    await click("Save");
    expect((host.querySelector("#goal-name") as HTMLInputElement).value).toBe(
      "My revised goal",
    );
    expect(
      (window as Window & { __OPEN_MUSE_HAS_UNSAVED_DOCUMENT__?: boolean })
        .__OPEN_MUSE_HAS_UNSAVED_DOCUMENT__,
    ).toBe(true);
    await click("Review cloud version");
    expect((host.querySelector("#goal-name") as HTMLInputElement).value).toBe(
      "My revised goal",
    );
    await click("Keep my name and use latest revision");
    await click("Save");
    expect(f.cloud()[0].title).toBe("My revised goal");
    expect(host.querySelector("#goal-name")).toBeNull();
    expect(p.props.onEditorChange).toHaveBeenLastCalledWith(false);
  });
  it("confirms deletion scope without erasing conversation history", async () => {
    const f = fixture([goal(), goal("child", "root")]);
    f.histories.set("existing", [{ id: "message", type: "user.message" }]);
    await mount(page(f).element);
    await click("Delete");
    expect(host.querySelector(".goal-delete-dialog")?.textContent).toContain(
      "Conversation history is preserved",
    );
    await click("Cancel");
    expect(f.cloud()).toHaveLength(2);
    await click("Delete");
    await click("Delete goal");
    expect(f.cloud()).toHaveLength(0);
    expect(f.histories.get("existing")).toHaveLength(1);
  });
  it("fills the main split composer, retains drafts on close, and writes only on Send", async () => {
    const f = fixture();
    location.hash = "/goals";
    await mount(<DesktopApp client={f.client} />);
    await click("Something else");
    await click("Let's do it");
    const composer = host.querySelector("textarea") as HTMLTextAreaElement;
    expect(composer.value).toBe("I want to start a goal about ");
    expect(f.stub.send).not.toHaveBeenCalled();
    expect(f.stub.create).not.toHaveBeenCalled();
    await click("Close side-by-side chat");
    await click("Open side-by-side chat");
    expect(composer.value).toBe("I want to start a goal about ");
    await type("I want to start a goal about painting", "textarea");
    await click("Send");
    expect(f.stub.prepareGoals).toHaveBeenCalledOnce();
    expect(f.stub.send).toHaveBeenCalledWith("main", {
      type: "user.message",
      text: "I want to start a goal about painting",
    });
  });
  it("keeps category follow-up messages in the dedicated conversation", async () => {
    const f = fixture();
    location.hash = "/goals";
    await mount(<DesktopApp client={f.client} />);
    await click("Health");
    await click("Let's do it");
    expect(host.querySelector(".chat-toolbar")?.textContent).toContain(
      "Health goal",
    );
    await type("I want to walk each morning", "textarea");
    await click("Send");
    expect(f.stub.send).toHaveBeenCalledWith("session-0", {
      type: "user.message",
      text: "I want to walk each morning",
    });
    expect(f.stub.openConversation).not.toHaveBeenCalled();
  });
  it("requires a replacement choice before overwriting an existing composer draft", async () => {
    const f = fixture();
    location.hash = "/goals";
    await mount(<DesktopApp client={f.client} />);
    await click("Open side-by-side chat");
    await type("My existing message", "textarea");
    await click("Something else");
    await click("Let's do it");
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "My existing message",
    );
    await click("Keep my draft");
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "My existing message",
    );
    expect(f.stub.send).not.toHaveBeenCalled();
    expect(f.stub.prepareGoals).not.toHaveBeenCalled();
    await click("Something else");
    await click("Let's do it");
    await click("Replace draft");
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe(
      "I want to start a goal about ",
    );
  });
  it("expands subgoals, persists subtitle preferences and opens completed goals", async () => {
    const f = fixture([
      goal(),
      goal("child", "root"),
      { ...goal("finished"), status: "completed" },
    ]);
    await mount(page(f).element);
    expect(
      host.querySelector('[aria-label="Open goal: Goal child"]'),
    ).toBeNull();
    await click("Expand subgoals for Goal root");
    expect(button("Open goal: Goal child")).toBeDefined();
    await click("Hide");
    expect(host.querySelector(".goal-row-open span")).toBeNull();
    await click("View completed goals");
    expect(host.querySelector(".goal-completed-dialog")?.textContent).toContain(
      "Goal finished",
    );
    expect(f.stub.prepareGoals).not.toHaveBeenCalled();
    expect(f.stub.ma).not.toHaveBeenCalled();
  });
});
