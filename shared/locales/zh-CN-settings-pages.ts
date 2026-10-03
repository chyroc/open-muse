// About, Devices, and Message channels in iPhone Settings.
export const zhSettingsPages: Record<string, string> = {
  "Development build": "开发版本",
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
  "Messages arrive once your workspace is set up and background work is on in Account and workspace.":
    "工作区准备好、并在“账号与工作区”中开启后台工作后，消息才会送达。",
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
};
