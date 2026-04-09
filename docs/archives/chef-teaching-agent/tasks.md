# Tasks: 厨师教学 Agent

## 已完成
- [x] 分析 `src/mastra/tools/obsidian/` 下所有工具及 shared.ts 的能力边界
- [x] 分析现有 Agent 结构（weather-agent / lesson-prep-agent）确认构造规范
- [x] 确认 obsidian 工具已在 index.ts 注册但尚未被任何 Agent 使用
- [x] 确认模型选项（models.ts）
- [x] 生成 spec.md / tasks.md / log.md

## 待确认
- [x] 用户确认 Q1：加 workingMemory（选项 B）
- [x] 用户确认 Q2：使用 qwen35PlusModel（选项 A）
- [x] 用户确认 Q3：不加 scorers（选项 A）
- [x] 用户显式确认提案文档，授权进入 Apply 阶段

## 实施任务（确认后执行）

> 以下任务全部为 **blocked / pending**，等待用户确认后再执行。

- [x] 新建 `src/mastra/agents/chef-teaching-agent.ts`
  - 依赖：Q1（Memory）、Q2（model）、Q3（scorers）确认
  - 前置：无
- [x] 在 `src/mastra/index.ts` import 并注册 `chefTeachingAgent`
  - 依赖：chef-teaching-agent.ts 创建完成
- [x] 运行 `npm run build` 验证编译通过
  - 依赖：所有实现任务完成
