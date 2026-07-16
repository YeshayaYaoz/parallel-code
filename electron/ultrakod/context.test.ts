import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import {
  initializeContext,
  loadContext,
  saveContext,
  updateContextForModelSwitch,
  setExecutiveSummary,
  setResetTime,
  isResetDue,
  getContextForModel,
} from './context.js';

const TEST_DIR = join(import.meta.dirname ?? '.', '__test_ultrakod__');

function cleanupTestDir(): void {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

beforeEach(() => {
  cleanupTestDir();
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  cleanupTestDir();
});

describe('initializeContext', () => {
  it('creates new context with correct defaults', () => {
    const context = initializeContext(TEST_DIR, 'test-project', 'claude-sonnet-4-20250514');

    expect(context.projectId).toBe('test-project');
    expect(context.projectRoot).toBe(TEST_DIR);
    expect(context.activeModel).toBe('claude-sonnet-4-20250514');
    expect(context.modelHistory).toEqual([]);
    expect(context.executiveSummary).toBe('');
    expect(context.resetAt).toBeUndefined();
    expect(context.createdAt).toBeTruthy();
    expect(context.updatedAt).toBeTruthy();
  });

  it('returns existing context if already initialized', () => {
    initializeContext(TEST_DIR, 'test-project', 'gpt-4o');
    const second = initializeContext(TEST_DIR, 'other-id', 'claude-opus-4-20250514');

    expect(second.projectId).toBe('test-project');
    expect(second.activeModel).toBe('gpt-4o');
  });

  it('persists context to disk', () => {
    initializeContext(TEST_DIR, 'test-project', 'gpt-4o');
    const loaded = loadContext(TEST_DIR);

    expect(loaded).not.toBeNull();
    expect(loaded?.projectId).toBe('test-project');
  });
});

describe('loadContext', () => {
  it('returns null when no context exists', () => {
    expect(loadContext(TEST_DIR)).toBeNull();
  });
});

describe('saveContext', () => {
  it('saves and loads context round-trip', () => {
    const context = initializeContext(TEST_DIR, 'test-project', 'gpt-4o');
    context.executiveSummary = 'Fixing auth bug';
    saveContext(context);

    const loaded = loadContext(TEST_DIR);
    expect(loaded?.executiveSummary).toBe('Fixing auth bug');
  });
});

describe('updateContextForModelSwitch', () => {
  it('records model switch in history', () => {
    let context = initializeContext(TEST_DIR, 'test-project', 'gpt-4o');
    context = updateContextForModelSwitch(context, 'claude-sonnet-4-20250514', 'quota exceeded');

    expect(context.activeModel).toBe('claude-sonnet-4-20250514');
    expect(context.modelHistory).toHaveLength(1);
    expect(context.modelHistory[0].fromModel).toBe('gpt-4o');
    expect(context.modelHistory[0].toModel).toBe('claude-sonnet-4-20250514');
    expect(context.modelHistory[0].reason).toBe('quota exceeded');
  });

  it('accumulates multiple switches', () => {
    let context = initializeContext(TEST_DIR, 'test-project', 'gpt-4o');
    context = updateContextForModelSwitch(context, 'claude-sonnet-4-20250514', 'upgrade');
    context = updateContextForModelSwitch(context, 'claude-opus-4-20250514', 'complex task');

    expect(context.modelHistory).toHaveLength(2);
    expect(context.activeModel).toBe('claude-opus-4-20250514');
  });
});

describe('setExecutiveSummary', () => {
  it('sets the summary', () => {
    const context = initializeContext(TEST_DIR, 'test-project', 'gpt-4o');
    const updated = setExecutiveSummary(context, 'Refactoring auth module');

    expect(updated.executiveSummary).toBe('Refactoring auth module');
  });
});

describe('setResetTime', () => {
  it('sets the reset time', () => {
    const context = initializeContext(TEST_DIR, 'test-project', 'gpt-4o');
    const resetTime = '2026-12-31T23:59:59Z';
    const updated = setResetTime(context, resetTime);

    expect(updated.resetAt).toBe(resetTime);
  });
});

describe('isResetDue', () => {
  it('returns false when no reset time set', () => {
    const context = initializeContext(TEST_DIR, 'test-project', 'gpt-4o');
    expect(isResetDue(context)).toBe(false);
  });

  it('returns false when reset time is in the future', () => {
    const context = initializeContext(TEST_DIR, 'test-project', 'gpt-4o');
    context.resetAt = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString();
    expect(isResetDue(context)).toBe(false);
  });

  it('returns true when reset time is in the past', () => {
    const context = initializeContext(TEST_DIR, 'test-project', 'gpt-4o');
    context.resetAt = new Date(Date.now() - 1000).toISOString();
    expect(isResetDue(context)).toBe(true);
  });
});

describe('getContextForModel', () => {
  it('returns JSON string with expected fields', () => {
    const context = initializeContext(TEST_DIR, 'test-project', 'gpt-4o');
    context.executiveSummary = 'Test summary';

    const result = getContextForModel(context, 'gpt-4o');
    const parsed = JSON.parse(result);

    expect(parsed.projectId).toBe('test-project');
    expect(parsed.activeModel).toBe('gpt-4o');
    expect(parsed.requestedModel).toBe('gpt-4o');
    expect(parsed.executiveSummary).toBe('Test summary');
    expect(parsed.modelHistory).toEqual([]);
  });
});
