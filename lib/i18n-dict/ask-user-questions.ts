// ask_user_questions tool UI — sticky question panel shown above the
// chat input. "Awaiting your answer" is also reused by SessionItem's
// sidebar dot tooltip, so it lives here rather than in chat.ts.

export const askUserQuestions = {
  "Awaiting your answer": "等待你的回答",
  "Type your own answer…": "请输入自定义回答…",
  "Answers sent": "回答已发送",
  "The agent is continuing…": "智能体会继续处理你的回答…",
  "{n} questions pending": "{n} 个问题待回答",
} as const;
