// About, Devices, and Message channels in iPhone Settings.
export const zhSettingsPages: Record<string, string> = {
  "Development build": "开发版本",
  Workspace: "工作区",
  "Version {version}": "版本 {version}",
  "Runs on": "运行于",
  "Volcano Ark website": "火山方舟官网",
  "Remove {name}": "移除{name}",
  "Remove {name} from this list? It stays signed in and shows up again the next time it opens Open Muse.":
    "要从列表中移除“{name}”吗？它仍保持登录，下次打开 Open Muse 时会重新出现。",
  "Each device signs in on its own. This list only shows where your account is used.":
    "每台设备单独登录。这里只显示你的账号在哪些设备上使用。",
  "Disconnect Lark? Messages to your Lark bot stop reaching your assistant at once.":
    "要断开飞书吗？发给飞书机器人的消息会立即不再转给你的助手。",
  "Message your assistant from another app, like texting anyone else. It answers there, and the conversation also shows here.":
    "像给其他人发消息一样，在其他 App 里给你的助手发消息。它会在那里回复，对话也会显示在这里。",
  "Needs an Open Muse account": "需要 Open Muse 账号",
  "Connected · last message {time}": "已连接 · 最近一条消息 {time}",
  "Connected · waiting for the first message": "已连接 · 等待第一条消息",
  "Messages arrive once background work has started for your account and Deliver even when Open Muse is closed is on in Upcoming.":
    "你的账号开始后台工作、并在“即将到来”中打开“Open Muse 关闭时也送达”后，消息才会送达。",
  "Finish in Lark": "在飞书中完成设置",
  "This address is shown only now. Copy it, or let your assistant set Lark up with it.":
    "这个地址只显示这一次。复制它，或让你的助手用它来设置飞书。",
  "In the Lark developer console, open the app your assistant uses with lark-cli and turn on its bot.":
    "在飞书开放平台打开你的助手通过 lark-cli 使用的应用，开启机器人能力。",
  "Under Events and callbacks, send events to this address and add the event for receiving messages (im.message.receive_v1). Leave the encrypt key empty.":
    "在“事件与回调”中把请求地址设为这个地址，并添加“接收消息”事件（im.message.receive_v1）。加密策略中的 Encrypt Key 留空。",
  "Publish the app version, then send your bot a message in Lark.":
    "发布应用版本，然后在飞书里给机器人发一条消息。",
  "Set up my Lark message channel: for the Lark app you use with lark-cli, turn on the bot, send its message events (im.message.receive_v1) to {address} with no encrypt key, and publish it. Tell me what I still need to do in the Lark console.":
    "帮我设置飞书消息渠道：在你通过 lark-cli 使用的飞书应用里开启机器人，把消息事件（im.message.receive_v1）的请求地址设为 {address}，不设置 Encrypt Key，然后发布。告诉我还需要在飞书开放平台里做什么。",
  "Ask my assistant to set it up": "让助手帮我设置",
  "Get a new address": "获取新地址",
  "The current address stops working. Use the new one in Lark.":
    "当前地址会失效，请在飞书中改用新地址。",
  "Disconnect Lark": "断开飞书",
  "Your assistant only reads the messages sent to your bot, never your other Lark chats, and acts on them only after confirming they come from your own Lark account. You can disconnect at any time.":
    "你的助手只会读取发给机器人的消息，不会读取你的其他飞书聊天，并且只在确认消息来自你本人的飞书账号后才会照做。你随时可以断开。",
  "Chat theme": "聊天主题",
  "Avatar size": "虚拟形象大小",
  "Match your companion": "与形象一致",
  Sky: "天蓝",
  Black: "黑色",
  Sand: "沙色",
  Lilac: "淡紫",
  Peach: "蜜桃",
  Lime: "青柠",
  Hidden: "已隐藏",
  "Extra large": "加大",
  Large: "大",
  Small: "小",
  "Manage permissions": "管理权限",
  "Read permission": "读取权限",
  "View health data": "查看健康数据",
  "View calendar events": "查看日历日程",
  "View reminders": "查看提醒事项",
  "Look up contacts": "查找联系人",
  Ask: "询问",
  Manage: "管理",
  "Nothing on this device is connected.": "这台设备上还没有连接任何内容。",
  "You can manage what Open Muse can access in the iPhone's Settings.":
    "你可以在 iPhone 的“设置”中管理 Open Muse 的访问权限。",
  "Allow shares what your assistant asks for without asking each time. Deny refuses every request.":
    "“允许”会直接分享助手请求的数据，不再每次询问；“拒绝”会拒绝所有请求。",
  "Your assistant asks before every read here. Deny refuses every request without asking.":
    "助手每次读取这里的数据前都会先询问你；“拒绝”会直接拒绝所有请求，不再询问。",
  "Only Apple Health reads can be allowed without asking.":
    "只有 Apple 健康的读取可以设为无需询问。",
  Notifications: "通知",
  "Allow notifications": "允许通知",
  "Get notified when your assistant replies after you leave the app, and when an Upcoming reminder is due.":
    "离开 App 后助手回复时，以及“即将到来”里的提醒到时，接收通知。",
  "Notifications are off for Open Muse in iOS.":
    "iOS 已关闭 Open Muse 的通知。",
  "What went wrong?": "哪儿出了问题？",
  "Describe the problem, the steps to reproduce it, and what you expected instead.":
    "请描述问题、重现步骤，以及预期结果与实际结果。",
  "What is this about?": "这个问题是关于哪方面的？",
  "Assistant status and activity": "助手状态和动态",
  Other: "其他",
  Submit: "提交",
  "Remove attachment": "移除附件",
  "Open Muse problem report": "Open Muse 问题报告",
  "Submit opens the share sheet so you choose where the report goes. It includes what you write and attach, the app version and the system version, and nothing else.":
    "提交时会打开分享面板，由你选择发到哪里。报告只包含你写的内容和附件、App 版本和系统版本，不含其他信息。",
  "Report copied. Paste it wherever you want to send it.":
    "报告已复制，粘贴到你想发送的地方即可。",
  "Report handed to the app you chose.": "报告已交给你选择的 App。",
  "Ask your assistant": "问问你的助手",
  "Send feedback": "提交反馈",
  "How do I use Open Muse? Tell me briefly what you can do for me and how to get started.":
    "Open Muse 怎么用？简单说说你能帮我做什么、我该怎么开始。",
  "Your assistant can explain any part of the app. Feedback goes wherever you choose in the share sheet.":
    "助手可以讲解 App 的任何功能。反馈会发到你在分享面板中选择的地方。",
  "Shake iPhone to report a problem": "摇晃手机来报告问题",
  "About AI messages": "关于 AI 消息",
  "Replies are generated by AI and may be inaccurate or inappropriate. Check important information before relying on it.":
    "回复由 AI 生成，部分内容可能不准确或不恰当。重要信息请先核实。",
  "Volcano Engine Privacy Policy": "火山引擎隐私政策",
  "Volcano Engine Terms of Service": "火山引擎服务条款",
  "Open Muse calls Volcano Ark with your own API key. What you send to your assistant is processed under these policies and kept in your Ark account.":
    "Open Muse 使用你自己的 API Key 调用火山方舟。你发给助手的内容按以上政策处理，并保存在你的方舟账号中。",
  "Volcano Engine": "火山引擎",
};
