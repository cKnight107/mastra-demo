// import { existsSync, readFileSync } from 'node:fs';
// import http from 'node:http';
// import https from 'node:https';
// import net from 'node:net';
// import path from 'node:path';
// import { ProxyAgent, setGlobalDispatcher } from 'undici';
// import { HttpsProxyAgent } from 'https-proxy-agent';

// const DEFAULT_PROXY_HOST = '127.0.0.1';
// const DISCORD_PROXY_URL = process.env.DISCORD_PROXY_URL?.trim();
// const HOME = process.env.HOME;

// const CANDIDATE_PROXY_CONFIGS = HOME
//   ? [
//       path.join(HOME, 'Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/config.yaml'),
//       path.join(HOME, 'Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/clash-verge.yaml'),
//       path.join(HOME, 'Library/Application Support/com.west2online.ClashXPro/config.yaml'),
//     ]
//   : [];

// const parseProxyUrlFromConfig = (configPath: string): string | null => {
//   if (!existsSync(configPath)) {
//     return null;
//   }

//   const config = readFileSync(configPath, 'utf8');
//   const mixedPort = config.match(/^\s*mixed-port:\s*(\d+)\s*$/m)?.[1];
//   if (mixedPort) {
//     return `http://${DEFAULT_PROXY_HOST}:${mixedPort}`;
//   }

//   const httpPort = config.match(/^\s*port:\s*(\d+)\s*$/m)?.[1];
//   if (httpPort) {
//     return `http://${DEFAULT_PROXY_HOST}:${httpPort}`;
//   }

//   return null;
// };

// const canConnectToProxy = async (proxyUrl: string): Promise<boolean> => {
//   const url = new URL(proxyUrl);
//   const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));

//   return await new Promise(resolve => {
//     const socket = net.connect(
//       {
//         host: url.hostname,
//         port,
//       },
//       () => {
//         socket.destroy();
//         resolve(true);
//       },
//     );

//     socket.once('error', () => {
//       resolve(false);
//     });

//     socket.setTimeout(300, () => {
//       socket.destroy();
//       resolve(false);
//     });
//   });
// };

// const resolveProxyUrl = (): string | null => {
//   if (DISCORD_PROXY_URL) {
//     return DISCORD_PROXY_URL;
//   }

//   for (const configPath of CANDIDATE_PROXY_CONFIGS) {
//     const proxyUrl = parseProxyUrlFromConfig(configPath);
//     if (proxyUrl) {
//       return proxyUrl;
//     }
//   }

//   return null;
// };

// const proxyUrl = resolveProxyUrl();

// if (proxyUrl && (await canConnectToProxy(proxyUrl))) {
//   // Proxy fetch() via undici
//   setGlobalDispatcher(new ProxyAgent(proxyUrl));

//   process.env.HTTP_PROXY ??= proxyUrl;
//   process.env.HTTPS_PROXY ??= proxyUrl;

//   // Proxy ws library (used by @discordjs/ws for Discord Gateway WebSocket).
//   // ws uses https.request for the handshake, which respects https.globalAgent.
//   const proxyAgent = new HttpsProxyAgent(proxyUrl);
//   https.globalAgent = proxyAgent as unknown as https.Agent;
//   http.globalAgent = proxyAgent as unknown as http.Agent;
// }
