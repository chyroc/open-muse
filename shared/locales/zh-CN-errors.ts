// Only app-authored errors are translated; upstream diagnostics remain verbatim.
export const zhErrors: Record<string, string> = {
  "This main chat's configuration cannot be safely updated. Its history is intact. Open a side chat to continue.":
    "无法安全更新此主要聊天的配置。历史记录完整保留，可新建旁聊继续。",
  "Invalid resource ID.": "资源 ID 无效。",
  "Check the API key and project name format.":
    "请检查 API Key 和项目名称格式。",
  "Add an Ark API key in Settings first.": "请先在设置中添加 Ark API Key。",
  "Generation preparation did not finish.": "生成准备尚未完成。",
  "Ark returned an invalid list response.": "Ark 返回的列表响应无效。",
  "Wait for the current response to finish before continuing this conversation.":
    "请等待当前回复完成后再继续此对话。",
  "Conversation history links are inconsistent. No history was replaced.":
    "对话历史关联不一致。未替换任何历史记录。",
  "Resolve the pending tool approval before continuing this conversation.":
    "请先处理待批准的工具操作，再继续此对话。",
  "Answer the request waiting in the chat first, then open the browser.":
    "请先回答聊天里正在等你处理的请求，再打开浏览器。",
  "The previous conversation changed while preparing. Its history is intact; resume to include the latest messages.":
    "准备期间，之前的对话发生了更改。历史记录完整保留；继续以包含最新消息。",
  "The agent instructions could not be read. No replacement conversation was created.":
    "无法读取智能体指令。未创建替代对话。",
  "Conversation preparation did not finish. No session was created.":
    "对话准备尚未完成。未创建会话。",
  "The first conversation is being prepared or its welcome is unconfirmed. Check its history before sending.":
    "首次对话正在准备中，或欢迎请求尚未确认。请先检查历史记录，再发送消息。",
  "The previous operation is still being submitted.": "上一个操作仍在提交中。",
  "Automatic confirmation can only allow safe reads.":
    "自动确认仅允许安全的读取操作。",
  "Already auto-approved; refresh history.": "已自动批准，请刷新历史记录。",
  "The tool is no longer pending; refresh history.":
    "此工具已不再等待批准，请刷新历史记录。",
  "This tool requires manual approval.": "此工具需要手动批准。",
  "An auto-approval is unconfirmed. Refresh history and handle it manually.":
    "自动批准结果尚未确认。请刷新历史记录后手动处理。",
  "The Ark event stream is disconnected; history will be refreshed.":
    "Ark 事件流已断开，将刷新历史记录。",
  "Duplicate step IDs.": "步骤 ID 重复。",
  "No savable assistant reply was found in Ark history.":
    "Ark 历史记录中没有可保存的助手回复。",
  "The saved background connection is invalid. Remove it before connecting again.":
    "已保存的后台连接无效。请移除后重新连接。",
  "The saved background connection does not match this build. Remove it before connecting again.":
    "已保存的后台连接与此版本不匹配。请移除后重新连接。",
  "Background service is not configured.": "尚未配置后台服务。",
  "Could not confirm the background request. Refresh to check its result; no request was retried automatically.":
    "无法确认后台请求结果。请刷新查看；未自动重试任何请求。",
  "Connect to the background service first.": "请先连接后台服务。",
  "The background connection changed; refresh before continuing.":
    "后台连接已更改，请刷新后继续。",
  "The service owner changed. Disconnect and verify the deployment before reconnecting.":
    "服务所有者已更改。请断开连接，核实部署后再重新连接。",
  "Encrypted credential storage is not available on this service.":
    "此服务不支持加密凭据存储。",
  "The current Ark workspace is incomplete. Refresh it before syncing.":
    "当前 Ark 工作区配置不完整。请刷新后再同步。",
  "Refresh the service before removing uploaded access.":
    "请先刷新服务，再移除已上传的访问配置。",
  "Invalid run reference.": "运行引用无效。",
  "Invalid background Feed cursor.": "后台动态游标无效。",
  "Invalid Feed ordering.": "动态排序无效。",
  "Saved login is invalid. Clear this app's credentials and sign in again.":
    "已保存的登录信息无效。请清除此应用的凭据并重新登录。",
  "This console-only operation is not available with an Ark API key.":
    "使用 Ark API Key 时无法执行此仅限控制台的操作。",
  "A sign-in operation is already in progress. Please wait.":
    "登录操作正在进行中，请稍候。",
  "Sign out before connecting another account.":
    "连接其他账号前，请先退出登录。",
  "Unknown sign-in operation.": "未知的登录操作。",
  "Confirm uploading the current Ark configuration first.":
    "请先确认上传当前 Ark 配置。",
  "Connect to Ark before syncing background access.":
    "同步后台访问配置前，请先连接 Ark。",
  "Prepare your personal memory in Settings before syncing background access.":
    "同步后台访问配置前，请先在设置中准备个人记忆。",
  "The local Ark login changed. Review the current account before syncing.":
    "本地 Ark 登录已更改。同步前请检查当前账号。",
  "The Ark agent response did not match this workspace.":
    "Ark 智能体响应与此工作区不匹配。",
  "This question is no longer awaiting an answer. Refresh history or continue in the message field.":
    "此问题已不再等待回答。请刷新历史记录，或在消息输入框中继续。",
  "This question changed. Refresh and review its options before choosing.":
    "此问题已更改。请刷新并检查选项后再选择。",
  "That option is not part of this question.": "该选项不属于此问题。",
  "Another selection is unconfirmed. Refresh history before continuing.":
    "另一个选择结果尚未确认。请刷新历史记录后继续。",
  "The selection is unconfirmed. Refresh history; it will not be sent again.":
    "选择结果尚未确认。请刷新历史记录；不会再次发送。",
  "Conversation links are inconsistent. No messages were sent.":
    "对话关联不一致。未发送任何消息。",
  "The main chat cannot be archived.": "主要聊天无法归档。",
  "This chat has continued. Refresh before sending; no message was submitted to the older conversation.":
    "此对话已延续到新会话。发送前请刷新；未向旧会话提交消息。",
  "Your main conversation is being prepared. Resume it before sending.":
    "主要聊天正在准备中。发送前请先继续准备。",
  "A main-chat message is unconfirmed or still being sent. Refresh history before submitting another.":
    "主要聊天中有消息尚未确认或仍在发送。请先刷新历史记录，再提交下一条。",
  "The main conversation update is unfinished. Return to the main chat and resume it first.":
    "主要聊天更新尚未完成。请先返回主要聊天并继续。",
  "Another operation is updating this conversation. Refresh to continue.":
    "另一个操作正在更新此对话。请刷新后继续。",
  "The main chat has ended. Open a side chat to continue; its history is preserved.":
    "主要聊天已结束。请打开旁聊继续；历史记录已保留。",
  "A conversation creation is unconfirmed. Refresh history and try again later; no duplicate was created.":
    "对话创建结果尚未确认。请刷新历史记录，稍后再试；未重复创建。",
  "The previous conversation was recovered. Open it from the sidebar before starting another.":
    "已恢复上一个对话。开始新对话前，请先从侧边栏打开它。",
  "Another window is opening this conversation. Refresh to continue.":
    "另一个窗口正在打开此对话。请刷新后继续。",
  "The conversation creation result is unconfirmed. Refresh history before retrying.":
    "对话创建结果尚未确认。请刷新历史记录后再重试。",
  "The main conversation update is unconfirmed. Refresh before trying again; no duplicate was created.":
    "主要聊天更新结果尚未确认。请刷新后再试；未重复创建。",
  "Another window is continuing this chat. Refresh history before sending.":
    "另一个窗口正在延续此对话。发送前请刷新历史记录。",
  "The continuation result is unconfirmed. Refresh before trying again.":
    "对话延续结果尚未确认。请刷新后再试。",
  "Conversation state changed. Refresh history before continuing.":
    "对话状态已更改。请刷新历史记录后继续。",
  "The main conversation changed during continuation. Its history has not been replaced.":
    "主要聊天在延续过程中发生了更改。历史记录未被替换。",
  "Goal already exists.": "目标已存在。",
  "Your goals changed. Refresh and review the latest progress before saving.":
    "目标已更改。保存前请刷新并检查最新进展。",
  "Goal not found.": "未找到目标。",
  "This conversation was not found.": "未找到这段对话。",
  "Invalid memory resource ID.": "记忆资源 ID 无效。",
  "Invalid memory list. No changes were made.":
    "记忆列表无效。未进行任何更改。",
  "Memory pagination did not finish. No changes were made.":
    "记忆分页读取未完成。未进行任何更改。",
  "The personal memory store response did not match the requested resource.":
    "个人记忆存储响应与请求的资源不匹配。",
  "The personal memory store is not owned by this connection. No changes were made.":
    "个人记忆存储不属于当前连接。未进行任何更改。",
  "Multiple personal memory stores were found. No store was selected or changed.":
    "找到多个个人记忆存储。未选择或更改任何存储。",
  "Memory setup is unconfirmed or running in another window. Refresh before trying again.":
    "记忆配置尚未确认，或正在另一个窗口中进行。请刷新后再试。",
  "The previous goal change is unconfirmed. Refresh goals before trying again.":
    "上次目标更改尚未确认。请刷新目标后再试。",
  "The previous feed-instructions write is unconfirmed. Reload to check its result before saving again.":
    "上次动态指令写入尚未确认。请重新加载并检查结果后再保存。",
  "Feed instructions changed since you opened them. Your draft is preserved; reload and review before saving.":
    "动态指令在打开后发生了更改。草稿已保留；请重新加载并检查后再保存。",
  "Invalid conversation archive path.": "对话归档路径无效。",
  "The conversation archive changed unexpectedly. No history was overwritten.":
    "对话归档发生了意外更改。未覆盖任何历史记录。",
  "Enter a name between 1 and 40 characters.": "请输入 1 到 40 个字符的名称。",
  "The previous memory write is unconfirmed. Reload the document to check its result; it has not been submitted twice.":
    "上次记忆写入尚未确认。请重新加载文档查看结果；未重复提交。",
  "This document changed since you opened it. Your draft is preserved; reload and review the latest version before saving.":
    "文档在打开后发生了更改。草稿已保留；请重新加载并检查最新版本后再保存。",
  "The saved document could not be verified. Reload before trying again.":
    "无法验证已保存的文档。请重新加载后再试。",
  "The generation session ID is unconfirmed. Refresh before proceeding; no duplicate was created.":
    "生成会话 ID 尚未确认。请刷新后继续；未重复创建。",
  "This generation changed in another window. Refresh to continue.":
    "另一个窗口更改了此次生成。请刷新后继续。",
  "Post not found.": "未找到动态。",
  "This post already has a discussion. Open it from the feed.":
    "此动态已有讨论。请从动态中打开。",
  "Generation finished without a reply. Open the conversation to inspect it.":
    "生成已结束，但没有回复。请打开对话检查。",
  "Generation is already in progress. Refresh to see it.":
    "生成已在进行中。请刷新查看。",
  "Another window is generating this content. Refresh to continue.":
    "另一个窗口正在生成此内容。请刷新后继续。",
  "Submission is unconfirmed. Refresh to check its result; no duplicate was sent.":
    "提交结果尚未确认。请刷新查看；未重复发送。",
  "Another window submitted this generation. Refresh to see it.":
    "另一个窗口已提交此次生成。请刷新查看。",
  "Unregistered MA operation.": "未注册的 MA 操作。",
  "Confirm the target and impact before modifying cloud resources.":
    "修改云端资源前，请确认操作对象和影响。",
  "Open the conversation to view the live event stream.":
    "打开对话以查看实时事件流。",
  "tos only supports bucket and prefix strings.":
    "tos 仅支持 bucket 和 prefix 字符串。",
  "File names must not contain paths.": "文件名不能包含路径。",
  "Files must be at most 10 MB.": "文件大小不能超过 10 MB。",
  "Skills must be ZIP files.": "技能必须是 ZIP 文件。",
  "Choose a file to upload first.": "请先选择要上传的文件。",
  "Missing secure storage bridge": "缺少安全存储桥接",
  "Secure storage timeout": "安全存储超时",
  "Couldn't access secure storage. Unlock your device and retry; your login has not been changed.":
    "无法访问安全存储。请解锁设备后重试；登录信息未被更改。",
  "Local storage is unavailable; no cloud changes were made.":
    "本地存储不可用；未更改云端数据。",
  "Couldn't save local data. Retry after checking device storage.":
    "无法保存本地数据。请检查设备存储后重试。",
  "This is not an allowed Volcano API endpoint.":
    "此火山引擎 API 地址不在允许范围内。",
  "Couldn't reach Volcano Ark. Check your network and try again. If this keeps happening while other sites load, Ark may have rejected the API key; check it in Settings.":
    "无法连接火山方舟。请检查网络后重试；如果其他网站都能打开却一直这样，可能是方舟拒绝了这个 API Key，请在设置中检查。",
  "Welcome state changed. Refresh before continuing.":
    "欢迎流程状态已更改。请刷新后继续。",
  "Another view is starting this conversation. Refresh its history.":
    "另一个视图正在启动此对话。请刷新历史记录。",
  "The welcome request is unconfirmed. Refresh history; it will not be sent again.":
    "欢迎请求尚未确认。请刷新历史记录；不会再次发送。",
  "Prepare your personal workspace in Settings first.":
    "请先在设置中准备个人工作区。",
  "Workspace preparation was cancelled.": "工作区准备已取消。",
  "Unexpected cloud resource list. Creation was stopped.":
    "云端资源列表异常。已停止创建。",
  "Could not read the complete resource list. Creation was stopped.":
    "无法读取完整资源列表。已停止创建。",
  "Creation result is unconfirmed. Resume to check cloud resources.":
    "创建结果尚未确认。继续以检查云端资源。",
  "A previous creation is unconfirmed or another app is preparing this workspace. Resume later to verify it; no duplicate was created.":
    "上次创建尚未确认，或另一个应用正在准备此工作区。请稍后继续验证；未重复创建。",
  "Invalid agent version; no policy changes were submitted.":
    "智能体版本无效；未提交策略更改。",
  "The Mac secure storage bridge is unavailable. Your credentials have not been changed.":
    "Mac 安全存储桥接不可用。凭据未被更改。",
  "Secure storage returned an invalid response.": "安全存储返回了无效响应。",
  "Secure storage did not confirm the update.": "安全存储未确认更新结果。",
  "The conversation result is unconfirmed. Refresh before continuing.":
    "对话结果尚未确认。请刷新后继续。",
  "This goal no longer exists. Refresh before making changes.":
    "此目标已不存在。请刷新后再进行更改。",
  "The goal hierarchy is invalid.": "目标层级无效。",
  "The connection changed. Reopen Goals before continuing.":
    "连接已更改。请重新打开目标页后继续。",
  "The connection changed. Reopen Goals to refresh.":
    "连接已更改。请重新打开目标页以刷新。",
  "Your goals changed during preparation. Refresh before saving.":
    "准备期间目标发生了更改。保存前请刷新。",
  "This goal no longer exists.": "此目标已不存在。",
  "The goal conversation changed. Refresh to continue.":
    "目标对话已更改。请刷新后继续。",
  "Custom goals begin with a draft, not an automatic send.":
    "自定义目标从草稿开始，不会自动发送。",
  "A previous goal conversation is unfinished. Continue it or refresh its history before starting another.":
    "之前的目标对话尚未完成。开始新对话前，请继续该对话或刷新其历史记录。",
  "Another window is starting a goal. Refresh to continue.":
    "另一个窗口正在启动目标。请刷新后继续。",
  "Another window is preparing this goal. Refresh to continue.":
    "另一个窗口正在准备此目标。请刷新后继续。",
  "Goal submission is unconfirmed. Refresh checks history; no request will be repeated.":
    "目标提交结果尚未确认。刷新只会检查历史记录，不会重复请求。",
  "Another window submitted this goal. Refresh to see it.":
    "另一个窗口已提交此目标。请刷新查看。",
  "The generated response is too large.": "生成的回复过长。",
  "Your idea context is too large. No generation request was sent.":
    "点子上下文过长。未发送生成请求。",
  "The connection changed. Reopen Ideas before continuing; no new request was sent.":
    "连接已更改。请重新打开点子页后继续；未发送新请求。",
  "The connection changed. Reopen Ideas to use the current account.":
    "连接已更改。请重新打开点子页以使用当前账号。",
  "Feedback must be 600 characters or fewer.": "反馈不能超过 600 个字符。",
  "This idea's submission is unconfirmed. Refresh history; it will not be sent again.":
    "此点子的提交结果尚未确认。请刷新历史记录；不会再次发送。",
  "Choose at least one included item.": "请至少选择一项内容。",
  "This idea is too large to send. No conversation was created.":
    "此点子过长，无法发送。未创建对话。",
  "Another window is starting this idea. Refresh to continue.":
    "另一个窗口正在启动此点子。请刷新后继续。",
  "Your assistant is still working. Finish or stop the current task before starting this idea.":
    "助手仍在工作。请先完成或停止当前任务，再启动此点子。",
  "A main-chat message is still unconfirmed. Refresh its history before starting this idea.":
    "主要聊天中仍有消息尚未确认。启动此点子前，请刷新历史记录。",
  "Another window submitted this idea. Refresh to see it.":
    "另一个窗口已提交此点子。请刷新查看。",
  "The connection to Volcano was interrupted before the response arrived. No request is retried automatically.":
    "响应返回前，与火山引擎的连接中断了。请求不会自动重试。",
  "Volcano did not answer in time. No request is retried automatically.":
    "火山引擎未能及时响应。请求不会自动重试。",
  Ark: "方舟",
  "{service} rejected this API key. Check it, or use a different key.":
    "{service}拒绝了这个 API Key。请检查它，或换一个 Key。",
  "{service} cannot use the model this needs with this API key.":
    "这个 API Key 无法在{service}上使用所需的模型。",
  "Your Ark account cannot use the model {model} yet. Enable it under Model activation in the Ark console, then try again.":
    "你的方舟账号还不能使用模型 {model}。请在方舟控制台的「开通管理」中开通后再试。",
  "Your Ark account cannot use the model this needs yet. Enable it under Model activation in the Ark console, then try again.":
    "你的方舟账号还不能使用所需的模型。请在方舟控制台的「开通管理」中开通后再试。",
  "Your Volcengine account is overdue or out of balance. Top it up, then try again.":
    "火山引擎账号已欠费或余额不足，充值后再试。",
  "Your {service} account is out of credit. Add credit, then try again.":
    "你的{service}账号余额不足，充值后再试。",
  "This API key is not allowed to do this. Check the key's project and permissions in the Ark console.":
    "这个 API Key 没有执行此操作的权限。请在方舟控制台检查 Key 所属的项目和权限。",
  "This API key is not allowed to do this.":
    "这个 API Key 没有执行此操作的权限。",
  "{service} is receiving too many requests right now. Try again in a moment.":
    "{service}当前请求过多，请稍后再试。",
  "The {service} resource this needs no longer exists.":
    "所需的{service}资源不存在或已被删除。",
  "{service} did not accept this request.": "{service}没有接受这个请求。",
  "{service} is temporarily unavailable. Try again later.":
    "{service}暂时不可用，请稍后再试。",
  "API keys were checked too many times in the last hour. Try again in an hour; the saved key is unchanged.":
    "过去一小时内校验 API Key 的次数太多了。请一小时后再试，已保存的 Key 不受影响。",
  "Workspace setup ran too many times in the last hour. Try again in an hour.":
    "过去一小时内配置工作区的次数太多了，请一小时后再试。",
};
