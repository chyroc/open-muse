const root =
  "https://github.com/win4r/MuseAI-Skills/tree/38bbb45a2c5a0f70de975f6387385770b9ad8aac/opt/hatch/skills/";
export const skillCandidates = [
  {
    name: "Markdown / 产物验收",
    status: "适合重写",
    level: "ready",
    path: "artifacts/testing",
    note: "参考生成后回读、渲染与可用性验收。改用 MA 文件工具和自有验证脚本。",
  },
  {
    name: "Wide Research",
    status: "需多 Agent 支持",
    level: "adapt",
    path: "wide-research",
    note: "统一研究字段、报告覆盖率与失败项；映射到 MA multiagent 配置。",
  },
  {
    name: "旅行规划 / 地点搜索",
    status: "需搜索能力",
    level: "adapt",
    path: "travel-planning",
    note: "可重写规划流程。预订、实时价格和交易须单独接入供应商。",
  },
  {
    name: "Gmail / Calendar / Notion",
    status: "需 MCP + OAuth",
    level: "adapt",
    path: "gmail",
    note: "必须替换 Muse CLI，并在 Vault 中连接账户；文档本身不提供访问权限。",
  },
  {
    name: "Goals / Forget",
    status: "需持久化与调度",
    level: "adapt",
    path: "forget",
    note: "MA Memory 可存储信息；提醒和完整遗忘仍需应用级调度及数据清理策略。",
  },
  {
    name: "设备 / Muse 专有能力",
    status: "不能直接使用",
    level: "blocked",
    path: "device-data",
    note: "HealthKit、穿戴设备、Muse 数据库、订阅与通信依赖原产品宿主和专有服务。",
  },
].map((item) => ({ ...item, url: root + item.path }));
