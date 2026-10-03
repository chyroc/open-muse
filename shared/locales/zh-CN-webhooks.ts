// Copy for incoming webhooks and for scheduled posts in the Feed.
export const zhWebhooks: Record<string, string> = {
  Webhooks: "Webhook",
  Webhook: "Webhook",
  "Let other services, such as Lark or your scripts, send events to your companion.":
    "让飞书、你的脚本等其他服务把事件发送给你的助手。",
  "Events are refused until background work is allowed in While you're away.":
    "在「离开应用后」中允许后台工作之前，事件会被拒绝。",
  "Events are refused until delivery while Open Muse is closed is on in Upcoming.":
    "在「即将到来」中开启「Open Muse 关闭时也送达」之前，事件会被拒绝。",
  "“{name}” is ready": "「{name}」已就绪",
  "Copy the secret now; it is shown only once. Send it as a Bearer token, or use the address with the token for services that cannot set headers.":
    "请立即复制密钥，它只会显示这一次。请以 Bearer 令牌发送；无法设置请求头的服务可使用带令牌的地址。",
  Address: "地址",
  Secret: "密钥",
  "Address with token": "带令牌的地址",
  "Copy {label}": "复制{label}",
  "I've saved it": "我已保存",
  "Webhook name": "Webhook 名称",
  "For example, Lark events": "例如：飞书事件",
  "Create webhook": "创建 Webhook",
  "Your webhooks": "你的 Webhook",
  "Last event {time}": "最近事件：{time}",
  "No events yet": "暂无事件",
  "Revoke “{name}”? Services using it stop reaching your companion at once.":
    "要撤销「{name}」吗？使用它的服务将立即无法再联系你的助手。",
  Revoke: "撤销",
  "Revoke {name}": "撤销 {name}",
  "No webhooks yet.": "还没有 Webhook。",
  "This account already has the most webhooks it can keep. Revoke one first.":
    "此账号的 Webhook 数量已达上限。请先撤销一个。",
  "Prepared while you were away, on your schedule.":
    "按你设定的时间，在你离开应用时准备。",
  "Generated with MA when you ask. Posts prepared on your account's schedule appear here too.":
    "按需通过 MA 生成。按账号计划准备的动态也会显示在这里。",
};
