# log: story-launcher-novel-support

## 提案阶段

### 2026-04-14 — 需求澄清记录

**背景**：`novelWorkflow` 已在上一个 change（`medium-novel-workflow`）中完成实现，现需要将现有 `storyLauncherAgent` 改造为同时支持短篇和中篇的统一入口。

**三轮澄清结论**：

| 轮次 | 问题 | 决策 |
|---|---|---|
| 第一轮 | 如何判断短篇 vs 中篇 | 对话识别关键词，模糊时主动追问，不静默推断 |
| 第二轮 | 工具架构 | 新建两个独立工具文件，短篇工具零改动 |
| 第三轮 | suspend 参数收集 | 仅用户主动提及时收集，默认 false |

**关键约束**：Agent id `story-launcher-agent` 保持不变，避免历史 thread memory 丢失。

**待实现阶段记录**：（Apply 阶段填写）
