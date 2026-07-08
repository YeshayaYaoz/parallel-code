export const ASK_CODE_MAX_PROMPT_LENGTH = 50_000;
export const ASK_CODE_MAX_CONCURRENT = 5;
export const ASK_CODE_TIMEOUT_MS = 120_000;
export const ASK_CODE_TIMEOUT_MESSAGE = 'Request timed out after 2 minutes.';
const TOO_MANY_CONCURRENT_MESSAGE = 'Too many concurrent ask-about-code requests';

export function assertPromptWithinLimit(prompt: string, max = ASK_CODE_MAX_PROMPT_LENGTH): void {
  if (prompt.length > max) {
    throw new Error(`Prompt too long (${prompt.length} chars, max ${max})`);
  }
}

export function assertCanStart<T>(registry: RequestRegistry<T>, requestId: string): void {
  if (!registry.canStart(requestId)) {
    throw new Error(TOO_MANY_CONCURRENT_MESSAGE);
  }
}

export class RequestRegistry<T> {
  private readonly entries = new Map<
    string,
    {
      request: T;
      timer: ReturnType<typeof setTimeout>;
      onCancel?: (request: T) => void;
    }
  >();

  constructor(
    private readonly opts: {
      maxConcurrent: number;
      timeoutMs: number;
    },
  ) {}

  get size(): number {
    return this.entries.size;
  }

  has(requestId: string): boolean {
    return this.entries.has(requestId);
  }

  canStart(requestId: string): boolean {
    return this.entries.has(requestId) || this.entries.size < this.opts.maxConcurrent;
  }

  start(
    requestId: string,
    request: T,
    onTimeout: (request: T) => void,
    onCancel?: (request: T) => void,
  ): void {
    this.cancel(requestId);
    if (this.entries.size >= this.opts.maxConcurrent) {
      throw new Error(TOO_MANY_CONCURRENT_MESSAGE);
    }

    const timer = setTimeout(() => {
      const entry = this.entries.get(requestId);
      if (!entry) return;
      this.entries.delete(requestId);
      onTimeout(entry.request);
      entry.onCancel?.(entry.request);
    }, this.opts.timeoutMs);

    this.entries.set(requestId, { request, timer, onCancel });
  }

  finish(requestId: string): T | undefined {
    const entry = this.entries.get(requestId);
    if (!entry) return undefined;
    clearTimeout(entry.timer);
    this.entries.delete(requestId);
    return entry.request;
  }

  cancel(requestId: string): boolean {
    const entry = this.entries.get(requestId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.entries.delete(requestId);
    entry.onCancel?.(entry.request);
    return true;
  }
}

/**
 * Shared per-request lifecycle glue for ask-code providers: every provider
 * (claude subprocess, MiniMax fetch, ...) races several completion paths
 * (success, error, timeout, cancel) against each other and must send exactly
 * one 'done' result while always releasing its RequestRegistry slot.
 */
export class AskCodeSession<T> {
  private finished = false;

  constructor(
    private readonly registry: RequestRegistry<T>,
    private readonly requestId: string,
  ) {}

  /** Releases the registry slot for this request. Safe to call more than once. */
  cleanup(): void {
    this.registry.finish(this.requestId);
  }

  /** Marks the request finished; returns false if a result was already sent. */
  complete(): boolean {
    if (this.finished) return false;
    this.finished = true;
    return true;
  }

  /** Standard timeout callback: reports the shared timeout message exactly once. */
  onTimeout(send: (msg: unknown) => void): void {
    if (!this.complete()) return;
    send({ type: 'error', text: ASK_CODE_TIMEOUT_MESSAGE });
    send({ type: 'done', exitCode: 1 });
  }
}
