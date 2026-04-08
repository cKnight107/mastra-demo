import { Agent } from '@mastra/core/agent';
import { qwen35PlusModel } from './models';

export const supervisor = new Agent({
  id: 'supervisor',
  name: 'Supervisor',
  description: '协调研究和写作使用专门的代理',
  instructions: `You coordinate research and writing using specialized agents.
    Delegate to weather-agent for weather facts, travel-agent for route information.`,
  model: qwen35PlusModel,
});
