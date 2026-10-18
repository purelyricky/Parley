import { join } from 'node:path';
import { ConfigError, loadConfig } from './config.js';
import { createProviders } from './providers/index.js';
import { createServer } from './server.js';
import { UserStore } from './users.js';
import { createLogger, type LogLevel } from './util/log.js';

const log = createLogger((process.env.LOG_LEVEL as LogLevel | undefined) ?? 'info');

let loaded: ReturnType<typeof loadConfig>;
try {
  loaded = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`\n${err.message}\n\nCopy .env.example to .env and fill it in (see README.md), then run:  npm run doctor\n`);
    process.exit(1);
  }
  throw err;
}
const { config, warnings } = loaded;

const users = new UserStore(join(config.dataDir, 'users.json'));
const server = createServer({ config, providers: createProviders(config, log), users, log });

const port = await server.listen();

console.log(`
  ┌──────────────────────────────────────────────┐
  │  Parley server is running                    │
  └──────────────────────────────────────────────┘
  local         http://localhost:${port}
  public URL    ${config.publicUrl ?? '(not set - needed for phone calls)'}
  phone calls   ${server.manager.phoneEnabled ? 'enabled (Telnyx)' : 'disabled'}
  voices        TTS ${config.ttsModel}, translation ${config.translationModel}
  limits        ${config.maxCallMinutes} min/call, ${config.maxConcurrentCalls} concurrent, ${config.phoneCallsPerHour} phone calls/user/hour
`);
for (const w of warnings) log.warn(w);

const shutdown = async (): Promise<void> => {
  log.info('shutting down…');
  await server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
