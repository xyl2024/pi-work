// ask_user_questions tool UI — sticky question panel shown above the
// chat input. "Awaiting your answer" is also reused by SessionItem's
// sidebar dot tooltip, so it lives here rather than in chat.ts.

export const askUserQuestions = {
  "Awaiting your answer": "等待你的回答",
  "Type your own answer…": "请输入自定义回答…",
  "Answers sent": "回答已发送",
  "The agent is continuing…": "智能体会继续处理你的回答…",
  "{n} questions pending": "{n} 个问题待回答",
  "Recommended": "推荐",
  "Why recommended": "推荐理由",
  "Note sent": "附言已发送",
  "Add a note for the agent…": "给智能体留一句话…",
  "Cancel with note": "连同附言取消",
  "Note to send when cancelling": "取消时发送的附言",
} as const;
