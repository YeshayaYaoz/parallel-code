// Minimal standalone logger — a stand-in for electron/log.ts's structured
// logger, which forwards renderer logs over IPC (an Electron-only concern
// this service has no equivalent of). Same debug/info/warn/error call shape
// so ported code (git.ts, pty.ts, coordinator.ts) needs no changes at call
// sites, just a different import target.
/* eslint-disable no-console */

export type LogContext = Record<string, unknown>;

function format(category: string, message: string, context?: LogContext): unknown[] {
  return context ? [`[${category}] ${message}`, context] : [`[${category}] ${message}`];
}

export function debug(category: string, message: string, context?: LogContext): void {
  console.debug(...format(category, message, context));
}

export function info(category: string, message: string, context?: LogContext): void {
  console.info(...format(category, message, context));
}

export function warn(category: string, message: string, context?: LogContext): void {
  console.warn(...format(category, message, context));
}

export function error(category: string, message: string, context?: LogContext): void {
  console.error(...format(category, message, context));
}
