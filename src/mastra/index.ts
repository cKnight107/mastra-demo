import { Mastra } from '@mastra/core/mastra';
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
import { toolCallAppropriatenessScorer, completenessScorer, translationScorer } from './scorers/weather-scorer';
import { storage as pgStorage } from './storage';
import { MastraCompositeStore } from '@mastra/core/storage'
import { DuckDBStore } from '@mastra/duckdb'
import { chatRoute } from '@mastra/ai-sdk'
type JwtClaims = {
  sub?: string;
  email?: string;
  name?: string;
  picture?: string;
};

const PUBLIC_API_PATHS = new Set(['/api/openapi.json']);
const OBSERVABILITY_REQUEST_CONTEXT_KEYS = [
  MASTRA_RESOURCE_ID_KEY,
  'auth_subject',
  'http_method',
  'http_path',
] as const;

const getJwtSubject = (user: unknown): string | null => {
  if (!user || typeof user !== 'object') {
    return null;
  }

  const sub = (user as JwtClaims).sub;
  return typeof sub === 'string' && sub.length > 0 ? sub : null;
};

export const mastra = new Mastra({
  workflows: { weatherWorkflow, branchTestWorkflow, foreachTestWorkflow, himtTestWorkflow, lessonPrepWorkflow },
  agents: { weatherAgent, travelAgent, supervisor, lessonPrepAgent },
  scorers: { toolCallAppropriatenessScorer, completenessScorer, translationScorer },
  server: {
    apiRoutes: [
      chatRoute({
        path: '/chat/:agentId',
      }),
    ],
    // auth: new MastraJwtAuth({
    //   secret: process.env.MASTRA_JWT_SECRET,
    //   public: ['/api/openapi.json'],
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
    //       if (c.req.method === 'OPTIONS' || PUBLIC_API_PATHS.has(c.req.path)) {
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
