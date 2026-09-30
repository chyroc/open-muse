export const zhAccount: Record<string, string> = {
  "This device cannot coordinate login renewal safely. Sign out of Muse and sign in again.":
    "此设备无法安全协调登录凭据更新。请退出 Muse 后重新登录。",
  "The account connection changed in another window. Sign out of Muse and sign in again.":
    "账号连接已在另一个窗口中变化。请退出 Muse 后重新登录。",
  "The account session was rejected or expired. Sign in again.":
    "账号登录凭据被拒绝或已过期。请重新登录。",
  "Muse account login": "Muse 账号登录",
  "Muse account": "Muse 账号",
  "Account email": "账号邮箱",
  "Account password": "账号密码",
  "Sign in to Muse": "登录 Muse",
  "Create Muse account": "创建 Muse 账号",
  "Use an existing account": "使用已有账号",
  "Create an account instead": "改为创建账号",
  "Sign in with your Muse account. Your Ark API key is saved to the account separately and is not used to identify you.":
    "使用 Muse 账号登录。Ark API Key 会另外保存到账号中，不会用来识别你的身份。",
  "Create a Muse account with this email. The Auth provider will receive the email and password.":
    "使用此邮箱创建 Muse 账号。认证服务将接收邮箱和密码。",
  "Registration submitted. Check your email if verification is required, then sign in. This does not confirm that a new account was created.":
    "注册请求已提交。如需邮箱验证，请先查收邮件，再登录。此提示不表示新账号已创建成功。",
  "Muse account login is not configured in this build.":
    "此构建尚未配置 Muse 账号登录。",
  "Account request failed (HTTP {status}). Check your login or provider configuration; no request was retried.":
    "账号请求失败（HTTP {status}）。请检查登录信息或认证服务配置；请求未重试。",
  "The account request could not be confirmed. It was not retried automatically.":
    "账号请求结果尚未确认。系统未自动重试。",
  "Enter a valid email and a password of at least 8 characters.":
    "请输入有效的邮箱，以及至少 8 个字符的密码。",
  "The account service returned an invalid login. No credentials were saved.":
    "认证服务返回的登录信息无效。未保存凭据。",
  "The account identity changed. Sign out of Muse and sign in again.":
    "账号身份已变化。请退出 Muse 后重新登录。",
  "Disconnect the current background connection before signing in to another Muse account.":
    "请先断开当前后台连接，再登录其他 Muse 账号。",
  "Sign in to a Muse account first.": "请先登录 Muse 账号。",
  "The previous login renewal could not be confirmed. Sign out of Muse and sign in again; it was not retried.":
    "上次登录凭据更新结果尚未确认。请退出 Muse 后重新登录；系统未重试。",
  "This connection is independent of the Ark login above. Signing out of Ark does not stop this schedule.":
    "此连接独立于上方的 Ark 登录。退出 Ark 不会停止此计划。",
  "The registration was not accepted. Check the email and password, or sign in if you already have an account. It was not retried.":
    "注册请求未被接受。请检查邮箱和密码；如已有账号，请直接登录。请求未重试。",
  "Your identity on every device. Your Ark API key, workspace, and history belong to it.":
    "你在所有设备上的身份。Ark API Key、工作区和历史记录都归属于此账号。",
  "Signed in": "已登录",
  "This device is connected to the service with a private device token. Remove that connection under Background Feed to sign in to a Muse account.":
    "此设备正通过私有设备令牌连接服务。请先在“后台动态”中移除该连接，再登录 Muse 账号。",
  "Signed in. Account ID: {id}": "已登录。账号 ID：{id}",
  "Signed out on this device. The account service could not confirm ending the session; it expires on its own.":
    "已在此设备上退出。账号服务未能确认结束该会话；它会自行过期。",
  "Sign out of Muse": "退出 Muse",
  "Signs out this device and ends this session at the account service. Other devices stay signed in. Nothing is deleted.":
    "在此设备上退出，并在账号服务端结束本次会话。其他设备保持登录，不会删除任何数据。",
  "Sign in to your Muse account to start chatting": "登录 Muse 账号后开始对话",
  "Sign in to your Muse account above to add your Ark API key.":
    "请先在上方登录 Muse 账号，再添加 Ark API Key。",
  "This device has an Ark API key saved by an earlier version of Open Muse. It is not used until you save it to your Muse account. Conversations and data from that earlier setup stay on this device and are not moved into your account.":
    "此设备上有旧版 Open Muse 保存的 Ark API Key。在你将它保存到 Muse 账号之前，不会使用它。旧设置下的对话和数据保留在此设备上，不会移入你的账号。",
  "Save this key to my account": "将此密钥保存到我的账号",
  "Remove it from this device": "从此设备移除",
  "Ark checks the key once, then it is stored encrypted in your Muse account so your signed-in devices can use it. The key is a model-service credential, not your identity. Replacing it starts a separate workspace and stops background work tied to the old key. Cloud calls may be billed.":
    "Ark 会先校验一次密钥，然后将其加密保存到你的 Muse 账号，供已登录的设备使用。此密钥只是模型服务凭据，不代表你的身份。更换密钥会使用另一个独立工作区，并停止与旧密钥关联的后台任务。云端调用可能产生费用。",
  "Save API key to my account": "将 API Key 保存到我的账号",
  "Saved in your Muse account": "已保存在你的 Muse 账号中",
  "Replace API key": "更换 API Key",
  "Remove the key from my Muse account on all devices and stop background work that uses it. The key stays valid at Ark until you revoke it there.":
    "从我的 Muse 账号中移除此密钥（所有设备生效），并停止使用它的后台任务。在 Ark 中撤销之前，密钥本身仍然有效。",
  "Remove API key from my account": "从我的账号移除 API Key",
  "Sign in to your Muse account above to use background features.":
    "请先在上方登录 Muse 账号，再使用后台功能。",
  "Allow background work with this workspace": "允许此工作区执行后台任务",
  "Your Ark API key is already saved in your Muse account. Allowing background work lets the service use it with this workspace's agent, environment, and memory while you are away. The service keeps this binding encrypted and its administrators remain trusted; this is not end-to-end encryption.":
    "你的 Ark API Key 已保存在 Muse 账号中。允许后台任务后，服务会在你离开时，结合此工作区的智能体、环境和记忆使用该密钥。服务会加密保存这一绑定，仍需信任服务管理员；这不是端到端加密。",
  "Background work allowed": "已允许后台任务",
  "Background work is not allowed yet.": "尚未允许后台任务。",
  "I allow the Muse service to use my saved Ark API key with this workspace for background Feed generation. Personal context will be read from Ark. Cloud calls may be billed.":
    "我允许 Muse 服务结合此工作区使用我保存的 Ark API Key 生成后台动态。个人上下文将从 Ark 读取。云端调用可能产生费用。",
  "Background work is allowed for this workspace. Review the schedule before enabling it.":
    "已允许此工作区执行后台任务。启用计划前请先检查设置。",
  "Allow background work": "允许后台任务",
  "Stop background work": "停止后台任务",
  "Sign in to your Muse account first.": "请先登录 Muse 账号。",
  "This workspace belongs to another Muse account. Nothing was changed.":
    "此工作区属于另一个 Muse 账号。未做任何更改。",
  "Too many attempts. Try again later.": "尝试次数过多，请稍后再试。",
  "Ark could not verify this key or workspace. Check it and try again; nothing was saved.":
    "Ark 无法验证此密钥或工作区。请检查后重试；未保存任何内容。",
  "Your Ark API key changed on another device. Reload Settings before allowing background work.":
    "你的 Ark API Key 已在其他设备上更改。请重新加载设置后，再允许后台任务。",
  "The Muse account changed. Reload before continuing.":
    "Muse 账号已变化。请重新加载后再继续。",
  "This device has no saved API key from an earlier version.":
    "此设备上没有旧版保存的 API Key。",
  "The last session renewal could not be confirmed, so this session is no longer used. Sign out of Muse and sign in again.":
    "上次会话续期结果无法确认，因此不再使用此会话。请退出 Muse 后重新登录。",
  "Your Ark API key changed on another device. Nothing was sent; review and try again.":
    "你的 Ark API Key 已在其他设备上更改。未发送任何请求；请检查后重试。",
  "Your Muse account session ended. Sign in again; nothing was sent.":
    "你的 Muse 账号会话已结束。请重新登录；未发送任何请求。",
  "Workspace setup needs review: an earlier step may have created a resource Open Muse will not use, or another device is preparing it. Continue setup to create a new one.":
    "工作区设置需要确认：之前的某一步可能已创建了 Open Muse 不会使用的资源，或者另一台设备正在设置。继续设置将创建新的资源。",
  "The workspace setup result is unconfirmed. Continue setup to check it; nothing was repeated.":
    "工作区设置结果尚未确认。继续设置以检查结果；未重复任何操作。",
  "The workspace setup did not finish. Continue setup.":
    "工作区设置尚未完成。请继续设置。",
  "With a Muse account, Studio reaches only this account's own agent, environment, memory, and sessions.":
    "使用 Muse 账号时，Studio 只能访问此账号自己的智能体、环境、记忆和会话。",
  "The workspace settings changed on another device. Refresh and review them before saving again.":
    "工作区设置已在其他设备上更改。请刷新并检查后再保存。",
  "The change is unconfirmed. Refresh the workspace to check it; it was not repeated.":
    "更改结果尚未确认。请刷新工作区检查；未重复提交。",
  "A workspace settings change is unconfirmed. Open Muse checks it before anything else is changed.":
    "工作区设置的一次更改结果尚未确认。Open Muse 会先检查它，再进行其他更改。",
  "The workspace settings need your review: they reference resources an account cannot use or differ from what Open Muse saved. Nothing was changed.":
    "工作区设置需要你确认：它们引用了账号无法使用的资源，或与 Open Muse 保存的设置不一致。未做任何更改。",
  "A deleted agent or environment cannot be restored because its saved settings reference resources an account cannot use. The saved settings are kept; recreate it with default settings to continue.":
    "已删除的智能体或环境无法恢复，因为保存的设置引用了账号无法使用的资源。已保存的设置会保留；如需继续，请使用默认设置重新创建。",
  "The change was sent but its result is unconfirmed. Open Muse checks it before anything else is changed; it was not repeated.":
    "更改已发送，但结果尚未确认。Open Muse 会先检查它，再进行其他更改；未重复提交。",
  "The change had not taken effect when Open Muse checked. It may still arrive later; Open Muse notices that at the next change. Nothing was sent again.":
    "Open Muse 检查时这次更改尚未生效。它仍可能稍后生效；下次更改时 Open Muse 会发现。未重复发送。",
  "You kept the saved settings, but the agent or environment in Ark may differ from them. Background work stays paused until they are checked.":
    "你保留了已保存的设置，但 Ark 中的智能体或环境可能与之不同。在检查之前，后台任务保持暂停。",
  "Check the settings again": "重新检查设置",
  "Keep the saved settings": "保留已保存的设置",
  "Check the last change": "检查上次更改",
  "Save the current settings": "保存当前设置",
  "Recreate with default settings": "使用默认设置重新创建",
};
