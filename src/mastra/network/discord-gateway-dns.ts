// import dns from 'node:dns';
// import { Resolver } from 'node:dns/promises';

// const DISCORD_GATEWAY_HOST = 'gateway.discord.gg';
// const DEFAULT_DNS_SERVERS = ['1.1.1.1', '8.8.8.8'];
// const DISCORD_GATEWAY_IP = process.env.DISCORD_GATEWAY_IP?.trim();
// const DISCORD_GATEWAY_DNS_SERVERS = process.env.DISCORD_GATEWAY_DNS_SERVERS
//   ?.split(',')
//   .map(server => server.trim())
//   .filter(Boolean);

// type LookupOptions = dns.LookupOneOptions | dns.LookupAllOptions;
// type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

// const originalLookup = dns.lookup.bind(dns);
// const originalPromisesLookup = dns.promises.lookup.bind(dns.promises);
// const resolver = new Resolver();

// resolver.setServers(DISCORD_GATEWAY_DNS_SERVERS?.length ? DISCORD_GATEWAY_DNS_SERVERS : DEFAULT_DNS_SERVERS);
// dns.setDefaultResultOrder('ipv4first');

// const normalizeLookupArguments = (
//   optionsOrCallback?: LookupOptions | number | LookupCallback,
//   callback?: LookupCallback,
// ): { options: LookupOptions; callback: LookupCallback } => {
//   if (typeof optionsOrCallback === 'function') {
//     return { options: {}, callback: optionsOrCallback };
//   }

//   if (typeof optionsOrCallback === 'number') {
//     return { options: { family: optionsOrCallback }, callback: callback as LookupCallback };
//   }

//   return { options: optionsOrCallback ?? {}, callback: callback as LookupCallback };
// };

// const toLookupResult = async (family = 0): Promise<dns.LookupAddress[]> => {
//   if (DISCORD_GATEWAY_IP) {
//     return [{ address: DISCORD_GATEWAY_IP, family: 4 }];
//   }

//   const results: dns.LookupAddress[] = [];

//   if (family !== 6) {
//     const ipv4 = await resolver.resolve4(DISCORD_GATEWAY_HOST);
//     results.push(...ipv4.map(address => ({ address, family: 4 as const })));
//   }

//   if (family !== 4) {
//     try {
//       const ipv6 = await resolver.resolve6(DISCORD_GATEWAY_HOST);
//       results.push(...ipv6.map(address => ({ address, family: 6 as const })));
//     } catch {
//       // IPv6 is optional here. Ignore and keep IPv4 results.
//     }
//   }

//   if (results.length === 0) {
//     throw new Error(`No DNS result for ${DISCORD_GATEWAY_HOST}`);
//   }

//   return results;
// };

// dns.lookup = (((hostname: string, optionsOrCallback?: LookupOptions | number | LookupCallback, callback?: LookupCallback) => {
//   const normalizedHostname = hostname.trim().toLowerCase();

//   if (normalizedHostname !== DISCORD_GATEWAY_HOST) {
//     return originalLookup(hostname, optionsOrCallback as never, callback as never);
//   }

//   const { options, callback: resolvedCallback } = normalizeLookupArguments(optionsOrCallback, callback);

//   void toLookupResult(options.family ?? 0)
//     .then(results => {
//       if ('all' in options && options.all) {
//         resolvedCallback(null, results);
//         return;
//       }

//       const first = results[0];
//       resolvedCallback(null, first.address, first.family);
//     })
//     .catch(() => {
//       originalLookup(hostname, options as never, resolvedCallback as never);
//     });
// }) as typeof dns.lookup);

// dns.promises.lookup = (async (hostname: string, options?: LookupOptions | number) => {
//   const normalizedHostname = hostname.trim().toLowerCase();

//   if (normalizedHostname !== DISCORD_GATEWAY_HOST) {
//     return originalPromisesLookup(hostname, options as never);
//   }

//   const normalizedOptions =
//     typeof options === 'number'
//       ? ({ family: options } satisfies LookupOptions)
//       : (options ?? {});

//   try {
//     const results = await toLookupResult(normalizedOptions.family ?? 0);

//     if ('all' in normalizedOptions && normalizedOptions.all) {
//       return results;
//     }

//     return results[0];
//   } catch {
//     return originalPromisesLookup(hostname, options as never);
//   }
// }) as typeof dns.promises.lookup;
