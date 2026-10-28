# 01: 消息来源的存取管道（shared 模型 + reader 回环 + 收口写入 + SSE 附带）

**What to build:** 打通消息来源「存得进、读得出」的完整链路，但用户可见变化为零。共享层落地消息来源的判别联合（网页端 / 频道 / 定时任务 / 子代理会话，实体 id + 名称快照都存）与四个纯函数：缺省回退（无标记 ≡ 网页端）、来源到图标/名称/悬停文案的映射、「prompt + 来源 → 待写标记数据」的构造（毫秒时间戳 + 文本前 80 字符，仅诊断用）、以及自定义标记的类型守卫。收口处接收可选的 origin 字段（网页端不传），派发 prompt 后立刻为非网页来源追加一条 `pi_work_message_origin` 自定义 entry；会话读取方扫描时把 entry 归属到树序最近的前一条用户消息并合并为消息上的可选 origin；SSE 的 message_end 事件附带同一 origin。origin 只活在 API/SSE 边界，绝不写回 JSONL 消息体。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] 共享层四个纯函数各有单元测试（Seam A）：无标记回退到网页端；entry 构造的时间戳与前缀截断规则；映射对四种来源各返回正确的图标/名称/文案；非法数据不抛错、按缺省处理
- [ ] reader 回环测试（Seam B）：沙箱会话文件里 user message + 紧跟的 origin entry，读取结果 origin 挂在树序最近的前一条 user message 上；无标记消息不带 origin；分支场景下 entry 随消息树脱落
- [ ] 收口处：网页端路径行为与现状完全一致（不传 origin、不写 entry）；传入 origin 时 JSONL 中出现紧跟的 `pi_work_message_origin` entry
- [ ] 历史 API 返回的消息带合并后的 origin；实时 SSE message_end 附带 origin
- [ ] origin 字段在任何路径下都不会被写进 JSONL 的消息体
- [ ] TypeScript 检查、ESLint、相关单元测试通过
