import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  validateCommand: vi.fn(),
  spawn: vi.fn(),
  minimax: { ask: vi.fn(), cancel: vi.fn(), isActive: vi.fn().mockReturnValue(false) },
  anthropic: { ask: vi.fn(), cancel: vi.fn(), isActive: vi.fn().mockReturnValue(false) },
  openai: { ask: vi.fn(), cancel: vi.fn(), isActive: vi.fn().mockReturnValue(false) },
  gemini: { ask: vi.fn(), cancel: vi.fn(), isActive: vi.fn().mockReturnValue(false) },
  deepseek: { ask: vi.fn(), cancel: vi.fn(), isActive: vi.fn().mockReturnValue(false) },
}));

vi.mock('./pty.js', () => ({ validateCommand: mocks.validateCommand }));
vi.mock('child_process', () => ({ spawn: mocks.spawn }));
vi.mock('./ask-code-minimax.js', () => ({
  askAboutCodeMinimax: mocks.minimax.ask,
  cancelAskAboutCodeMinimax: mocks.minimax.cancel,
  isMinimaxRequestActive: mocks.minimax.isActive,
}));
vi.mock('./ask-code-anthropic.js', () => ({
  askAboutCodeAnthropic: mocks.anthropic.ask,
  cancelAskAboutCodeAnthropic: mocks.anthropic.cancel,
  isAnthropicRequestActive: mocks.anthropic.isActive,
}));
vi.mock('./ask-code-openai.js', () => ({
  askAboutCodeOpenai: mocks.openai.ask,
  cancelAskAboutCodeOpenai: mocks.openai.cancel,
  isOpenaiRequestActive: mocks.openai.isActive,
}));
vi.mock('./ask-code-gemini.js', () => ({
  askAboutCodeGemini: mocks.gemini.ask,
  cancelAskAboutCodeGemini: mocks.gemini.cancel,
  isGeminiRequestActive: mocks.gemini.isActive,
}));
vi.mock('./ask-code-deepseek.js', () => ({
  askAboutCodeDeepseek: mocks.deepseek.ask,
  cancelAskAboutCodeDeepseek: mocks.deepseek.cancel,
  isDeepseekRequestActive: mocks.deepseek.isActive,
}));

import { askAboutCode, cancelAskAboutCode } from './ask-code.js';

function makeMockWin() {
  return {
    isDestroyed: vi.fn().mockReturnValue(false),
    webContents: { send: vi.fn() },
  } as unknown as import('electron').BrowserWindow;
}

describe('askAboutCode routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.spawn.mockReturnValue({
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
    });
  });

  it.each(['minimax', 'anthropic', 'openai', 'gemini', 'deepseek'] as const)(
    'routes provider=%s to its own adapter, not the claude CLI',
    (provider) => {
      const win = makeMockWin();
      askAboutCode(win, { requestId: 'r1', channelId: 'ch1', prompt: 'hi', cwd: '/tmp', provider });

      expect(mocks[provider].ask).toHaveBeenCalledWith(win, {
        requestId: 'r1',
        channelId: 'ch1',
        prompt: 'hi',
      });
      expect(mocks.spawn).not.toHaveBeenCalled();
    },
  );

  it('falls back to spawning the claude CLI when no provider (or "claude") is given', () => {
    const win = makeMockWin();
    askAboutCode(win, { requestId: 'r2', channelId: 'ch2', prompt: 'hi', cwd: '/tmp' });

    expect(mocks.validateCommand).toHaveBeenCalledWith('claude');
    expect(mocks.spawn).toHaveBeenCalled();
    for (const provider of ['minimax', 'anthropic', 'openai', 'gemini', 'deepseek'] as const) {
      expect(mocks[provider].ask).not.toHaveBeenCalled();
    }
  });
});

describe('cancelAskAboutCode', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(['minimax', 'anthropic', 'openai', 'gemini', 'deepseek'] as const)(
    'cancels the %s adapter when it reports the request as active',
    (provider) => {
      mocks[provider].isActive.mockReturnValue(true);

      cancelAskAboutCode('r1');

      expect(mocks[provider].cancel).toHaveBeenCalledWith('r1');
    },
  );

  it('does not cancel any direct-API provider when none report the request active', () => {
    cancelAskAboutCode('r1');

    for (const provider of ['minimax', 'anthropic', 'openai', 'gemini', 'deepseek'] as const) {
      expect(mocks[provider].cancel).not.toHaveBeenCalled();
    }
  });
});
