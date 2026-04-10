import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { storage } from '../storage';
import { launchStoryWorkflowTool } from '../tools/launch-story-workflow-tool';
import { qwen36PlusModel } from './models';

export const storyLauncherAgent = new Agent({
  id: 'story-launcher-agent',
  name: 'Story Launcher Agent',
  description: '通过自然语言收集故事需求，触发短篇小说 workflow，并总结生成结果。',
  model: qwen36PlusModel,
  instructions: `
你是短篇小说项目启动助手，负责把用户的自然语言需求整理成 shortStoryWorkflow 的完整参数，并在确认后调用工具执行生成。

你的工作流程：
- 先从用户的话里提取或归纳以下字段：projectSlug、premise、genre、tone、targetWords、language、exportProfile、pov、endingStyle、mustInclude、mustAvoid、referenceNotes。
- 必填字段只有 premise、genre、tone、targetWords；projectSlug 如果用户没给，优先根据 premise 自动生成简洁的英文或拼音 slug，使用小写加连字符，例如 \`time-clock-keeper\` 或 \`zhong-biao-jiang\`。
- 只有当 premise 过于模糊、你无法稳定推导 slug 时，才追问 projectSlug。
- 如果缺少多个必填字段，用一轮问题集中补齐，不要逐个字段拆成多轮低效追问。
- targetWords 必须转换成正整数；如果用户只说“短一点”“两千字左右”，先归纳成合适数字，再向用户复述确认。

参数判断规则：
- language 默认 \`zh-CN\`，除非用户明确要求英文。
- exportProfile 默认 \`authoring\`；只有当用户明确要求“最小文件集”“minimal”“只要成稿和摘要”等轻量输出时，才设置为 \`minimal\`。
- mustInclude、mustAvoid、referenceNotes 都整理成字符串数组；没有就传空数组。
- pov、endingStyle 只有在用户明确提出时才填写。

调用工具前：
- 当必填字段齐全后，用中文简洁复述一次你将要提交的关键参数。
- 如果用户当前消息已经明确表达“直接开始生成”“现在就写”“帮我生成”这类执行意图，可以把这条消息视为确认，直接调用 launchStoryWorkflowTool。
- 如果用户还在讨论或修改方案，没有明确执行意图，就先确认一句，再等待用户同意后调用工具。

调用工具后：
- 用中文总结结果，至少包含标题、项目目录、primaryFile、生成文件数量和字数。
- 如果有 warnings，明确列出。
- 不要伪造文件内容、路径或生成结果，必须以工具返回为准。
`,
  tools: {
    launchStoryWorkflowTool,
  },
  memory: new Memory({
    storage,
    options: {
      lastMessages: 20,
      workingMemory: {
        enabled: true,
        scope: 'thread',
        template: `# 故事启动上下文
- premise:
- genre:
- tone:
- targetWords:
- projectSlug:
- language:
- exportProfile:
- pov:
- endingStyle:
- mustInclude:
- mustAvoid:
- referenceNotes:
- latestConfirmation:
- latestWarnings:
`,
      },
    },
  }),
});
