import { useEffect, useState } from "react";
import { Check, LoaderCircle, RefreshCw } from "lucide-react";
import type { Client } from "./api";
import type { WorkspaceStatus } from "../shared/types";

export function WorkspacePanel({ client }: { client: Client }) {
  const [status, setStatus] = useState<WorkspaceStatus>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const value = await client.request<WorkspaceStatus>("/workspace", {
          signal: abort.signal,
        });
        if (!abort.signal.aborted) {
          setStatus(value);
          setError("");
        }
        if (value.state === "preparing" && !abort.signal.aborted)
          timer = setTimeout(() => void read(), 1000);
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      }
    };
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, busy]);
  const preparing = busy || status?.state === "preparing";
  async function prepare() {
    if (busy || (preparing && !error)) return;
    setBusy(true);
    setError("");
    try {
      setStatus(
        await client.request<WorkspaceStatus>(
          !status || error ? "/workspace" : "/workspace/prepare",
          !status || error
            ? {}
            : {
                method: "POST",
                body: "{}",
              },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="workspace-card" aria-label="个人工作空间">
      <div className="workspace-heading">
        {preparing ? (
          <LoaderCircle className="spin" size={20} />
        ) : (
          <Check size={20} />
        )}
        <div>
          <h3>个人工作空间</h3>
          <p>助手与运行环境由 Muse 自动管理，无需手动配置。</p>
          <p>云端环境可访问公网；网页搜索与读取自动批准，其他工具仍需确认。</p>
        </div>
        <span className="small-badge">
          {preparing
            ? "准备中"
            : status?.state === "ready"
              ? "已就绪"
              : status?.state === "demo"
                ? "待连接"
                : "待准备"}
        </span>
      </div>
      <p role="status">{error || status?.message || "正在读取工作空间状态…"}</p>
      {status?.state === "ready" ? (
        <a className="button primary" href="#/">
          开始一件新事
        </a>
      ) : (
        status?.state !== "demo" && (
          <button
            className="button secondary"
            disabled={busy || (preparing && !error)}
            onClick={() => void prepare()}
          >
            {preparing ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <RefreshCw size={16} />
            )}
            {error
              ? "重新读取状态"
              : preparing
                ? "正在自动准备…"
                : status?.state === "error"
                  ? "继续准备"
                  : "准备工作空间"}
          </button>
        )
      )}
      {status?.state === "demo" && (
        <a className="button secondary" href="#/settings">
          登录并连接项目
        </a>
      )}
    </section>
  );
}
