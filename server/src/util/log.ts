export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
  child(prefix: string): Logger;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

export function createLogger(level: LogLevel = 'info', prefix = ''): Logger {
  const emit = (lvl: Exclude<LogLevel, 'silent'>, msg: string, meta?: unknown): void => {
    if (ORDER[lvl] < ORDER[level]) return;
    const ts = new Date().toISOString().slice(11, 23);
    const line = `${ts} ${lvl.toUpperCase().padEnd(5)} ${prefix ? `[${prefix}] ` : ''}${msg}`;
    const out = lvl === 'error' ? console.error : lvl === 'warn' ? console.warn : console.log;
    if (meta === undefined) out(line);
    else out(line, meta instanceof Error ? meta.message : meta);
  };
  return {
    debug: (m, x) => emit('debug', m, x),
    info: (m, x) => emit('info', m, x),
    warn: (m, x) => emit('warn', m, x),
    error: (m, x) => emit('error', m, x),
    child: (p) => createLogger(level, prefix ? `${prefix}:${p}` : p),
  };
}

export const silentLogger: Logger = createLogger('silent');
