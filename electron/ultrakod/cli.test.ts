import { describe, it, expect } from 'vitest';
import { parseArgs } from './cli.js';

describe('parseArgs', () => {
  it("parses --mode as a space-separated value (the workflow and the CLI's own help text both use this form)", () => {
    // Reproduces a real failure: `ultrakod route --mode balanced` (exactly
    // what .github/workflows/ultrakod-router.yml runs on a 15-minute
    // schedule, and what the CLI's own --help text recommends) always
    // printed "Mode required" -- every other flag here falls back to the
    // next argv token when there's no `=`, but --mode didn't.
    const args = parseArgs(['node', 'cli.cjs', 'route', '--mode', 'balanced']);
    expect(args.mode).toBe('balanced');
  });

  it('parses --mode=value (equals-sign form) the same way', () => {
    const args = parseArgs(['node', 'cli.cjs', 'route', '--mode=extra']);
    expect(args.mode).toBe('extra');
  });

  it('parses --project as a space-separated value', () => {
    const args = parseArgs(['node', 'cli.cjs', 'status', '--project', '/tmp/repo']);
    expect(args.projectRoot).toBe('/tmp/repo');
  });
});
