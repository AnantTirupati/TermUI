// ─────────────────────────────────────────────────────
// @termuijs/adapters — execa integration
// ─────────────────────────────────────────────────────

import type { Options } from 'execa';

export interface UseExecaResult {
  run(
    cmd: string | string[],
    argsOrOpts?: string[] | Options,
    opts?: Options
  ): AsyncGenerator<string, void, unknown>;
}

let _execaModule: typeof import('execa') | undefined;

/**
 * Lazily loads the execa module.
 */
async function getExeca(): Promise<typeof import('execa')> {
  if (_execaModule) return _execaModule;
  try {
    _execaModule = await import('execa');
    return _execaModule;
  } catch (err) {
    throw new Error(
      'useExeca() requires the optional peer dependency `execa`. ' +
        'Please install `execa@^8.0.0` or newer in your project before using useExeca().',
      { cause: err }
    );
  }
}

/**
 * Hook to execute external commands using execa.
 * Streams stdout and stderr interleaved as an AsyncIterable of lines.
 */
export function useExeca(globalOpts?: Options): UseExecaResult {
  return {
    async *run(
      cmd: string | string[],
      argsOrOpts?: string[] | Options,
      opts?: Options
    ): AsyncGenerator<string, void, unknown> {
      const execaModule = await getExeca();
      // Type assertion is needed to support fallback resolutions across bundler modules
      const execaFn = (execaModule.execa ?? (execaModule as any).default ?? execaModule) as typeof execaModule.execa;

      let file: string;
      let args: string[] = [];
      let options: Options = {};

      if (Array.isArray(cmd)) {
        if (cmd.length === 0) {
          throw new Error('useExeca: Command array must not be empty.');
        }
        file = cmd[0];
        args = cmd.slice(1);
        if (argsOrOpts && !Array.isArray(argsOrOpts)) {
          options = argsOrOpts as Options;
        }
      } else {
        file = cmd;
        if (Array.isArray(argsOrOpts)) {
          args = argsOrOpts;
          options = opts ?? {};
        } else if (argsOrOpts) {
          options = argsOrOpts as Options;
        }
      }

      const mergedOpts: Options = {
        ...globalOpts,
        ...options,
        all: true,
        buffer: false,
        env: (globalOpts?.env || options?.env) ? {
          ...globalOpts?.env,
          ...options?.env,
        } : undefined,
      };

      const child = execaFn(file, args, mergedOpts);
      const stream = child.all;
      if (!stream) {
        throw new Error('useExeca: stdout/stderr stream (child.all) is not available.');
      }

      let buffer = '';
      for await (const chunk of stream) {
        const chunkStr = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        buffer += chunkStr;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          yield line;
        }
      }
      if (buffer) {
        yield buffer;
      }

      await child;
    },
  };
}

/**
 * Convenience alias for useExeca.
 */
export const useShell = useExeca;
