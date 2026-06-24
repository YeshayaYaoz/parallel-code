import { describe, expect, it } from 'vitest';
import {
  AUTO_TASK_NAME_MAX_LENGTH,
  DISPLAY_TASK_NAME_MAX_LENGTH,
  autoTaskNameFromPrompt,
  cleanTaskName,
  displayTaskNameFromPrompt,
  isAutoTaskNameFromPrompt,
  nextDefaultTaskName,
  shouldUsePromptDerivedTaskName,
} from './clean-task-name';

describe('cleanTaskName', () => {
  it('removes stacked filler prefixes', () => {
    expect(cleanTaskName('Please try to shorten the task name')).toBe('shorten the task name');
  });
});

describe('autoTaskNameFromPrompt', () => {
  it('uses the cleaned first line when it fits', () => {
    expect(autoTaskNameFromPrompt('we should shorten the task name slightly less')).toBe(
      'shorten the task name slightly less',
    );
  });

  it('keeps a bit more text before truncating on a word boundary', () => {
    expect(
      autoTaskNameFromPrompt(
        'please improve the task name generation so it keeps a little more detail before truncating',
      ),
    ).toBe('improve the task name generation so it');
  });

  it('falls back to a hard cut when the first word exceeds the limit', () => {
    expect(autoTaskNameFromPrompt(`please ${'a'.repeat(AUTO_TASK_NAME_MAX_LENGTH + 5)}`)).toBe(
      'a'.repeat(AUTO_TASK_NAME_MAX_LENGTH),
    );
  });

  it('ignores later lines', () => {
    expect(autoTaskNameFromPrompt('please shorten this title\nbut ignore this line')).toBe(
      'shorten this title',
    );
  });
});

describe('displayTaskNameFromPrompt', () => {
  it('keeps more context for visible task titles', () => {
    expect(
      displayTaskNameFromPrompt(
        'please improve the task name generation so it keeps a little more detail before truncating',
      ),
    ).toBe('improve the task name generation so it keeps a little more detail before truncating');
  });

  it('still caps very long display titles on a word boundary', () => {
    expect(
      displayTaskNameFromPrompt(`please ${'alpha '.repeat(40).trim()}`).length,
    ).toBeLessThanOrEqual(DISPLAY_TASK_NAME_MAX_LENGTH);
  });
});

describe('isAutoTaskNameFromPrompt', () => {
  it('matches the restored 40-character auto name', () => {
    expect(
      isAutoTaskNameFromPrompt(
        'improve the task name generation so it',
        'please improve the task name generation so it keeps a little more detail before truncating',
      ),
    ).toBe(true);
  });

  it('matches the temporary 50-character auto name from the previous change', () => {
    expect(
      isAutoTaskNameFromPrompt(
        'improve the task name generation so it keeps a',
        'please improve the task name generation so it keeps a little more detail before truncating',
      ),
    ).toBe(true);
  });

  it('does not match a custom task name', () => {
    expect(
      isAutoTaskNameFromPrompt(
        'custom display title',
        'please improve the task name generation so it keeps a little more detail before truncating',
      ),
    ).toBe(false);
  });
});

describe('shouldUsePromptDerivedTaskName', () => {
  const prompt =
    'please improve the task name generation so it keeps a little more detail before truncating';

  it('honors an explicit false flag after a manual rename', () => {
    expect(
      shouldUsePromptDerivedTaskName('improve the task name generation so it', prompt, false),
    ).toBe(false);
  });

  it('honors an explicit true flag for newly auto-generated names', () => {
    expect(shouldUsePromptDerivedTaskName('custom short name', prompt, true)).toBe(true);
  });

  it('falls back to prompt matching for legacy tasks without the flag', () => {
    expect(shouldUsePromptDerivedTaskName('improve the task name generation so it', prompt)).toBe(
      true,
    );
  });
});

describe('nextDefaultTaskName', () => {
  it('returns "Task 1" when there are no existing tasks', () => {
    expect(nextDefaultTaskName([])).toBe('Task 1');
  });

  it('returns "Task 1" when no existing name matches the pattern', () => {
    expect(nextDefaultTaskName(['Add auth', 'Fix bug'])).toBe('Task 1');
  });

  it('picks the next number above the highest existing "Task N"', () => {
    expect(nextDefaultTaskName(['Task 1', 'Task 2'])).toBe('Task 3');
  });

  it('uses the max, not the count, so gaps do not cause collisions', () => {
    expect(nextDefaultTaskName(['Task 5'])).toBe('Task 6');
  });

  it('orders numerically, not lexically', () => {
    expect(nextDefaultTaskName(['Task 3', 'Task 10'])).toBe('Task 11');
  });

  it('is case-sensitive — lowercase "task" does not match', () => {
    expect(nextDefaultTaskName(['task 3'])).toBe('Task 1');
  });

  it('ignores names that only resemble the pattern', () => {
    expect(nextDefaultTaskName(['Task 1 done', 'Task two', 'Subtask 9'])).toBe('Task 1');
  });

  it('tolerates surrounding whitespace on existing names', () => {
    expect(nextDefaultTaskName(['  Task 3  '])).toBe('Task 4');
  });
});
