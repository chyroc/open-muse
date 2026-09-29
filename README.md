# Open Muse

基于火山方舟 Managed Agents（MA）的个人 AI 任务助手，提供 iOS、macOS 和手机优先的 Web 界面，并保留 Android 工程。

支持连续对话、工具审批、执行记录、目标管理、回复收藏和 Markdown 导出。默认演示模式不调用模型、不执行外部操作；连接真实 MA 后，云端调用可能计费。

## 快速开始

需要 Node.js 22.21+。原生 Apple 平台构建需要 Xcode。

```bash
npm ci
npm run dev           # Web 4310，服务端 4311
npm run check         # 类型检查和自动测试
npm run build         # 生产网页
npm run macos:build   # 独立 macOS App
npm run ios:build     # iOS Simulator App
```

开发页面：[http://127.0.0.1:4310](http://127.0.0.1:4310)。生产模式执行 `npm run build && npm start`，访问 [http://127.0.0.1:4311](http://127.0.0.1:4311)。

## 连接方舟

### SSO 登录

1. 打开「设置 → 连接方舟 MA → 火山 SSO」，点击「开始 SSO 登录」。
2. 在火山官网完成授权，把授权码或完整回调地址粘贴回应用。
3. 选择项目，阅读权限和计费说明，点击「连接项目并开始使用」。
4. 等待工作空间就绪，即可开始对话。

服务端使用 OAuth + PKCE 兑换 STS，并创建项目 API Key。该 Key 可访问所选项目的全部方舟资源，不限制来源 IP。授权事务有效期 10 分钟，仅可兑换一次；应用登录会话有效期 7 天。

### 手动输入 API Key

1. 打开「设置 → 连接方舟 MA → API Key」。
2. 粘贴已有密钥；项目名称可选，留空由方舟按密钥确定项目。
3. 点击「连接 API Key」。服务端先通过 `/models` 校验，再加密保存凭据。
4. 首次发送任务或点击「准备工作空间」时自动创建助手与运行环境。

Agent／Environment 映射保存在本地 SQLite，按上游地址、密钥摘要和项目隔离。相同连接重登后复用映射，不需要用户填写资源 ID。创建失败会保留已完成步骤；结果不明确时先查询，不盲目重复创建。

客户端只持有应用会话令牌。iOS 和 macOS 使用 Keychain 恢复令牌；Web 只在当前 `sessionStorage` 中保存。退出登录删除应用保存的登录凭据，但不会撤销云端 API Key；撤销需在方舟控制台操作。

两种登录方式默认使用生产数据面。服务管理员可通过 `MUSE_SSO_ARK_BASE_URL` 设置可信上游；客户端不能提交任意上游地址。API Key 不提供 STS，需要 STS 的控制面操作仍须 SSO。

### 服务端配置

可从 `.env.example` 创建本地 `.env`。直接使用服务端 Key 时配置：

```dotenv
MUSE_MODE=ark
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_API_KEY=在本地填写密钥
```

可选 `ARK_PROJECT_NAME` 通过 `X-Project-Name` 指定项目。`ARK_MODEL_ID` 指定模型；留空自动选择支持工具调用的文本模型。`ARK_AGENT_ID`、`ARK_ENVIRONMENT_ID` 用于兼容已有部署，普通用户界面不展示这些 ID。

## 原生客户端

### iOS

工程为 `ios/App/App.xcodeproj`，Scheme 为 `App`，Bundle ID 为 `app.openmuse.mobile`。使用 Capacitor 与 Swift Package Manager；执行 `npm run ios` 可在 Xcode 打开。

首次运行填写 **Open Muse 服务根地址**，不是方舟 API 地址。模拟器可使用 `http://127.0.0.1:4311`；物理设备需要可访问的 HTTPS 服务，手机上的回环地址不能连接 Mac。

iOS 不内嵌服务端。SSO 外链使用系统浏览器，导出使用系统分享面板。模拟器构建使用 ad-hoc 签名；不要禁用签名，否则 Keychain 可能返回权限错误。

### macOS

构建产物为 `.build/macos/Open Muse.app`，可直接打开，不需要另开服务终端。AppKit / WKWebView 原生壳内嵌服务端，仅监听随机回环端口。

本地数据保存在用户的 `Library/Application Support/Open Muse/`。构建产物不包含个人凭据或已有任务。目前为 macOS 14+、本机架构开发版本，尚未公证或配置自动更新。

### Android

保留 Capacitor 工程与平台资源。当前没有 Android 编译或设备验收结论。

## 功能与权限

- 手机导航包括聊天、动态、灵感、目标和资料库；设置、所有对话与 MA 工作台位于侧边菜单。
- 目标支持步骤、状态和对话关联；暂停目标不等于停止正在运行的会话。目标不会自动定时执行。
- 资料库收藏真实助手回复，可查看来源与导出。动态来自会话，灵感使用预设建议。
- MA 工作台提供 52 项适配操作，覆盖智能体、环境、会话、记忆、连接、技能和文件。高级管理默认折叠，写操作需要确认，删除需要核对目标 ID。

对话通过 SSE 接收事件，在订阅、重连和恢复前台时补拉历史，并按事件 ID 去重。写请求不自动重试；超时后应先检查历史结果。

内置 `web_search` 和 `web_fetch` 的待确认请求自动批准，仅精确匹配协议名称，不包含同名 MCP 工具或其他操作。其他工具仍需手动确认。搜索词和访问请求可能发往外部服务，自动批准不等于没有数据外发风险。

自动审批保留提交状态和审计记录。结果不明确时恢复手动入口，不盲目重复批准；该流程依赖任务页打开，不是后台调度服务。

[MA 接入范围](docs/ma-coverage.md)说明适配范围与限制。[MuseAI-Skills 评估](docs/skills.md)说明技能所需依赖和许可边界。

## 部署与安全边界

本项目适用于个人本地使用或受控单用户部署，不是可直接公开运营的多租户服务。远程部署至少配置：

```dotenv
HOST=0.0.0.0
MUSE_ACCESS_TOKEN=设置至少24位随机令牌
MUSE_ALLOWED_ORIGINS=https://你的网页域名,capacitor://localhost,https://localhost
```

使用 HTTPS 反向代理并关闭 SSE 缓冲。应用访问令牌保护整个 BFF，不是方舟 API Key，也不是公开注册体系。

方舟凭据使用 AES-256-GCM，密文与密钥文件权限为 `0600`；两者同机保存，不能抵御已取得该用户文件权限的攻击者。SQLite 保存资源映射，不保存原始 API Key；任务与收藏为明文 JSON。需要保护数据目录与备份。

没有登录会话时使用配置的默认工作区，不要把共享访问令牌当作严格租户隔离。当前存储适用于单进程；公开部署仍需完善限流、审计、备份和数据保留策略。

## 验证与开发

已通过自动测试与 iOS 模拟器上的真实 MA 对话、网页工具、收藏和重启恢复测试。详细结果和未覆盖范围见 [验证记录](docs/verification.md)。

提交约定见 [贡献指南](CONTRIBUTING.md)，第三方许可说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

```text
src/         界面与客户端适配
shared/      事件类型、审批策略与 API 目录
server/      OAuth、加密凭据、方舟适配与 BFF
ios/         iOS 工程
macos/       macOS 原生壳
android/     Android 工程
tests/       单元、接口与前端测试
scripts/     构建与资源生成
docs/        接入说明与验证记录
.build/      本地构建与测试产物，不提交
.data/       本地数据与凭据，不提交
```
