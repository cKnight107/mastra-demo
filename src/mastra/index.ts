// import './network/discord-proxy';
// import './network/discord-gateway-dns';
import { Mastra } from '@mastra/core/mastra';
import { fileURLToPath } from 'node:url';
import { MASTRA_RESOURCE_ID_KEY } from '@mastra/core/request-context';
import { PinoLogger } from '@mastra/loggers';
import { Observability, DefaultExporter, CloudExporter, SensitiveDataFilter, SamplingStrategyType } from '@mastra/observability';
import { MastraJwtAuth } from '@mastra/auth';
import { getAuthenticatedUser } from '@mastra/server/auth';
import { weatherWorkflow } from './workflows/weather-workflow';
import { branchTestWorkflow } from './workflows/branch-workflow';
import { foreachTestWorkflow } from './workflows/foreach-workflow';
import { himtTestWorkflow } from './workflows/himt-workflow';
import { lessonPrepWorkflow } from './workflows/lesson-prep-workflow';
import { weatherAgent } from './agents/weather-agent';
import { travelAgent } from './agents/travel-agent';
import { supervisor } from './agents/team-agent';
import { lessonPrepAgent } from './agents/lesson-prep-agent';
import { storyWriterAgent } from './agents/story-writer-agent';
import { toolCallAppropriatenessScorer, completenessScorer, translationScorer } from './scorers/weather-scorer';
import { storage as pgStorage } from './storage';
import { MastraCompositeStore } from '@mastra/core/storage'
import { DuckDBStore } from '@mastra/duckdb'
import { chatRoute } from '@mastra/ai-sdk'
import { MastraEditor } from '@mastra/editor'
type JwtClaims = {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
};

export const DISCORD_WEBHOOK_PUBLIC_PATHS = ['/api/agents/travel-agent/channels/discord/webhook'] as const;

// Keep Discord webhook public when JWT auth is re-enabled, otherwise Discord signature validation cannot complete.
export const AUTH_PUBLIC_API_PATHS = ['/api/openapi.json', ...DISCORD_WEBHOOK_PUBLIC_PATHS] as const;
const OBSERVABILITY_REQUEST_CONTEXT_KEYS = [
  MASTRA_RESOURCE_ID_KEY,
  'auth_subject',
  'http_method',
  'http_path',
] as const;
const OBSERVABILITY_DUCKDB_PATH = fileURLToPath(new URL('../../.mastra-observability.duckdb', import.meta.url));

const getJwtSubject = (user: unknown): string | null => {
  if (!user || typeof user !== 'object') {
    return null;
  }

  const sub = (user as JwtClaims).sub;
  return typeof sub === 'string' && sub.length > 0 ? sub : null;
};

export const mastra = new Mastra({
  editor: new MastraEditor(),
  workflows: { weatherWorkflow, branchTestWorkflow, foreachTestWorkflow, himtTestWorkflow, lessonPrepWorkflow },
  agents: { weatherAgent, travelAgent, supervisor, lessonPrepAgent, storyWriterAgent },
  scorers: { toolCallAppropriatenessScorer, completenessScorer, translationScorer },
  server: {
    apiRoutes: [
      chatRoute({
        path: '/chat/:agentId',
      }),
    ],
    // auth: new MastraJwtAuth({
    //   secret: process.env.MASTRA_JWT_SECRET,
    //   public: [...AUTH_PUBLIC_API_PATHS],
    //   authorizeUser: async user => getJwtSubject(user) !== null,
    //   mapUser: payload => {
    //     const id = getJwtSubject(payload);
    //     if (!id) {
    //       return null;
    //     }

    //     return {
    //       id,
    //       email: typeof payload.email === 'string' ? payload.email : undefined,
    //       name: typeof payload.name === 'string' ? payload.name : undefined,
    //       avatarUrl: typeof payload.picture === 'string' ? payload.picture : undefined,
    //     };
    //   },
    // }),
    // middleware: [
    //   {
    //     path: '/api/*',
    //     handler: async (c, next) => {
    //       if (c.req.method === 'OPTIONS' || AUTH_PUBLIC_API_PATHS.includes(c.req.path as (typeof AUTH_PUBLIC_API_PATHS)[number])) {
    //         return next();
    //       }

    //       const authHeader = c.req.header('Authorization');
    //       if (!authHeader) {
    //         return c.json({ error: 'Unauthorized' }, 401);
    //       }

    //       const user = await getAuthenticatedUser<JwtClaims>({
    //         mastra: c.get('mastra'),
    //         token: authHeader,
    //         request: c.req.raw,
    //       });
    //       const subject = getJwtSubject(user);

    //       if (!subject) {
    //         return c.json({ error: 'Unauthorized' }, 401);
    //       }

    //       const requestContext = c.get('requestContext');
    //       requestContext.set(MASTRA_RESOURCE_ID_KEY, subject);
    //       requestContext.set('auth_subject', subject);
    //       requestContext.set('http_method', c.req.method);
    //       requestContext.set('http_path', c.req.path);
    //       await next();
    //     },
    //   },
    // ],
  },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: pgStorage,
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    },
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [new DefaultExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});

