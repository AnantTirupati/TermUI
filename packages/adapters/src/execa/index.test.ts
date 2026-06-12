// ─────────────────────────────────────────────────────
// @termuijs/adapters — Tests for useExeca
// ─────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useExeca, useShell } from './index.js';
import { Readable } from 'node:stream';
import { execa } from 'execa';

vi.mock('execa', () => {
  return {
    execa: vi.fn(),
  };
});

describe('useExeca', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockChild(chunks: string[], exitCode = 0) {
    const stream = Readable.from(chunks);
    const promise = new Promise<any>((resolve, reject) => {
      stream.on('end', () => {
        if (exitCode === 0) {
          resolve({ exitCode, all: stream });
        } else {
          const err = new Error(`Command failed with exit code ${exitCode}`);
          (err as any).exitCode = exitCode;
          reject(err);
        }
      });
    });

    return Object.assign(promise, {
      all: stream,
    });
  }

  it('streams lines of stdout/stderr as they emit', async () => {
    const mockChild = createMockChild(['hello\nworld', '\nfoo\nbar\n']);
    vi.mocked(execa).mockReturnValue(mockChild as any);

    const { run } = useExeca();
    const lines: string[] = [];
    for await (const line of run('test-cmd', ['arg1'])) {
      lines.push(line);
    }

    expect(execa).toHaveBeenCalledWith('test-cmd', ['arg1'], {
      all: true,
      buffer: false,
    });
    expect(lines).toEqual(['hello', 'world', 'foo', 'bar']);
  });

  it('accepts command array', async () => {
    const mockChild = createMockChild(['ok\n']);
    vi.mocked(execa).mockReturnValue(mockChild as any);

    const { run } = useExeca();
    const lines: string[] = [];
    for await (const line of run(['my-cmd', 'arg1', 'arg2'], { env: { DEBUG: '1' } })) {
      lines.push(line);
    }

    expect(execa).toHaveBeenCalledWith('my-cmd', ['arg1', 'arg2'], {
      all: true,
      buffer: false,
      env: { DEBUG: '1' },
    });
    expect(lines).toEqual(['ok']);
  });

  it('merges global options with local options', async () => {
    const mockChild = createMockChild(['ok\n']);
    vi.mocked(execa).mockReturnValue(mockChild as any);

    const { run } = useExeca({ env: { GLOBAL: 'yes' }, timeout: 1000 });
    const iterator = run('my-cmd', { env: { LOCAL: 'yes' } });
    await iterator.next();

    expect(execa).toHaveBeenCalledWith('my-cmd', [], {
      all: true,
      buffer: false,
      env: { GLOBAL: 'yes', LOCAL: 'yes' },
      timeout: 1000,
    });
  });

  it('propagates errors when command fails with non-zero exit code', async () => {
    const mockChild = createMockChild(['some error\n'], 1);
    vi.mocked(execa).mockReturnValue(mockChild as any);

    const { run } = useExeca();
    const lines: string[] = [];

    await expect(async () => {
      for await (const line of run('fail-cmd')) {
        lines.push(line);
      }
    }).rejects.toThrow('Command failed with exit code 1');

    expect(lines).toEqual(['some error']);
  });

  it('exposes useShell as an alias of useExeca', () => {
    expect(useShell).toBe(useExeca);
  });
});
