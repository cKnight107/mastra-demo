import { Agent } from '@mastra/core/agent';
import { OpenAICompatibleConfig } from '@mastra/core/llm';
import { routeCitiesTool } from '../tools/route-cities-tool';
import { Memory } from '@mastra/memory';
import { storage, vector } from '../storage';
const qwen35plus: OpenAICompatibleConfig = {
  id: 'dashscope/qwen3.5-plus',
  apiKey: process.env.DASHSCOPE_API_KEY,
  url: process.env.DASHSCOPE_BASE_URL,
};

export const travelAgent = new Agent({
  id: 'travel-agent',
  name: 'Travel Agent',
  description: '分析中国城市之间的沿线主要城市与基础旅行路径信息',
  instructions: `
    你是一名中文旅行路线助手，擅长分析中国两座城市之间沿线的主要城市。

    当用户询问“从 A 到 B 之间会经过哪些城市”“沿途主要城市有哪些”“郑州到北京中间有什么主要城市”这类问题时：
    - 优先使用 routeCitiesTool 获取结构化结果
    - 如果用户没有明确给出出发地或目的地，先追问补全
    - 默认按路线顺序列出沿线城市，而不是按城市级别乱序输出
    - 明确说明这是基于城市坐标和路线走廊的近似分析，不等同于实时地图导航
    - 回答使用简洁中文

    如果工具返回的城市较少，也要如实说明，不要编造额外城市。
  `,
  model: qwen35plus,
  tools: { routeCitiesTool },
  memory: new Memory({
      storage,
      options: {
        lastMessages: 20,
        workingMemory: {
          enabled: true,
          scope: 'resource',
          template: `# User Profile
  - Name: 
  - Preferred Language: 
  - Preferred Temperature Unit:
  - Common Locations: 
  - Travel Interests:
  - Long-term Preferences:
  `,
        }
      },
    }),
});
