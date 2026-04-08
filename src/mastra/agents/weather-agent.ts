import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { ModelRouterEmbeddingModel } from '@mastra/core/llm';
import { weatherTool } from '../tools/weather-tool';
import { scorers } from '../scorers/weather-scorer';
import { storage, vector } from '../storage';
import { qwen35FlashModel, qwen35PlusModel, textEmbeddingV4Model } from './models';

export const weatherAgent = new Agent({
  id: 'weather-agent',
  name: 'Weather Agent',
  instructions: `
      You are a helpful weather assistant that provides accurate weather information and can help planning activities based on the weather.

      Your primary function is to help users get weather details for specific locations. When responding:
      - Always ask for a location if none is provided
      - If the location name isn't in English, please translate it
      - If giving a location with multiple parts (e.g. "New York, NY"), use the most relevant part (e.g. "New York")
      - Include relevant details like humidity, wind conditions, and precipitation
      - Keep responses concise but informative
      - If the user asks for activities and provides the weather forecast, suggest activities based on the weather forecast.
      - If the user asks for activities, respond in the format they request.

      Use the weatherTool to fetch current weather data.
`,
  description: 'Provides weather information and activity suggestions based on weather conditions',
  model: qwen35PlusModel,
  tools: { weatherTool },
  scorers: {
    toolCallAppropriateness: {
      scorer: scorers.toolCallAppropriatenessScorer,
      sampling: {
        type: 'ratio',
        rate: 1,
      },
    },
    completeness: {
      scorer: scorers.completenessScorer,
      sampling: {
        type: 'ratio',
        rate: 1,
      },
    },
    translation: {
      scorer: scorers.translationScorer,
      sampling: {
        type: 'ratio',
        rate: 1,
      },
    },
  },
  memory: new Memory({
    storage,
    vector,
    embedder: new ModelRouterEmbeddingModel(textEmbeddingV4Model),
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
      },
      observationalMemory: {
        model: qwen35FlashModel,
        scope: 'thread',
      },
      semanticRecall: {
        topK: 3,
        messageRange: 2,
        scope: 'resource',
        indexConfig: {
          type: 'hnsw',
          metric: 'dotproduct',
          hnsw: {
            m: 16,
            efConstruction: 64,
          },
        },
      },
    },
  }),
});
