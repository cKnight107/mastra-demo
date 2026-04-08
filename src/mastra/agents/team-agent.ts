import { Agent } from '@mastra/core/agent';
import { qwen35PlusModel } from './models';
import {travelAgent} from './travel-agent'
import { weatherAgent } from './weather-agent';
import { Memory } from '@mastra/memory';
import { storage } from '../storage';

export const supervisor = new Agent({
  id: 'supervisor',
  name: 'Supervisor',
  description: '协调天气和旅行信息使用专门的代理',
  instructions: `You coordinate research and writing using specialized agents.
    Delegate to weather-agent for weather facts, travel-agent for route information.`,
  model: qwen35PlusModel,
  agents: { weatherAgent, travelAgent },
  memory: new Memory({
      storage,
    }),
});
