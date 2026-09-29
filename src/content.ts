import type { Category } from "../shared/types";

export const categories: Record<Category, string> = {
  general: "日常助手",
  research: "深度研究",
  writing: "灵感写作",
  life: "生活规划",
  code: "代码与工具",
};
export const templates: {
  id: string;
  title: string;
  detail: string;
  prompt: string;
  category: Category;
  art: string;
}[] = [
  {
    id: "weekend",
    title: "给周末，一个小小的逃离",
    detail: "不赶路的旅行，从这里开始",
    prompt:
      "帮我规划一个轻松的周末两日旅行。先问我出发地、目的地、预算和喜好，再制定一份不赶路的行程。",
    category: "life",
    art: "landscape",
  },
  {
    id: "research",
    title: "把好奇，变成有据可依",
    detail: "研究一个话题，整理关键观点",
    prompt:
      "我想深入了解一个新话题。请先问我研究主题和用途，再整理研究框架；引用资料时注明来源，并区分事实和推测。",
    category: "research",
    art: "orbit",
  },
  {
    id: "writing",
    title: "让脑海里的想法落笔",
    detail: "从一个念头，到一篇好内容",
    prompt:
      "帮我把一个想法写成清晰、有个人风格的文章。先了解我的核心观点、目标读者和发布场景。",
    category: "writing",
    art: "paper",
  },
  {
    id: "email",
    title: "替我起草，等我确认",
    detail: "体验需要批准的操作",
    prompt:
      "帮我起草一封项目进展邮件。先确认收件人和内容，发送之前必须请求我的批准。",
    category: "writing",
    art: "mail",
  },
  {
    id: "code",
    title: "一个念头，一个小工具",
    detail: "把重复的工作变成自动化",
    prompt:
      "我想做一个解决重复工作的小工具。请先了解我的工作流程、输入输出和运行环境，再给出最小可用实现和验证方法。",
    category: "code",
    art: "code",
  },
  {
    id: "read",
    title: "读懂，比读完更重要",
    detail: "提取材料的结构、观点与问题",
    prompt:
      "帮我分析一份材料。我会随后提供正文，请提炼核心结论、论证结构、存在的假设，以及值得继续追问的问题。",
    category: "research",
    art: "book",
  },
];
