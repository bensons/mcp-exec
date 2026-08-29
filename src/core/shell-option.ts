/**
 * Shared resolution/validation of the `shell` option handed to child_process.spawn.
 *
 * Semantics:
 *   undefined -> true   (platform default shell)
 *   true      -> true   (platform default shell)
 *   false     -> false  (spawn the command directly, no shell, args stay separate)
 *   string    -> absolute path to the requested shell executable
 */

import { accessSync, constants, statSync } from 'fs';
import { delimiter, extname, isAbsolute, resolve } from 'path';

// Relative shell values must be bare executable names. Absolute paths are passed
// to spawn as a discrete option, so spaces and parentheses in those paths are
// safe and must remain valid (for example, Program Files on Windows).
const UNSAFE_BARE_NAME_CHARS = /[\s/\\;&|<>$`"'()]/;

export interface ShellResolutionOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) {
      return false;
    }
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function getEnvironmentValue(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  name: string
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(env, name)) {
    return env[name];
  }

  if (process.platform !== 'win32') {
    return undefined;
  }

  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

function resolveBareShell(
  candidate: string,
  options: ShellResolutionOptions
): string | undefined {
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const pathValue = getEnvironmentValue(env, 'PATH') || '';
  const pathEntries = pathValue.split(delimiter);

  const extensions = process.platform === 'win32'
    ? (() => {
        if (extname(candidate)) {
          return [''];
        }
        const pathExt = getEnvironmentValue(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD';
        return pathExt.split(';').filter(Boolean);
      })()
    : [''];

  for (const pathEntry of pathEntries) {
    // An empty or relative PATH entry is interpreted relative to the child's cwd,
    // matching executable lookup after spawn changes into that directory.
    const searchDirectory = isAbsolute(pathEntry)
      ? pathEntry
      : resolve(cwd, pathEntry || '.');

    for (const extension of extensions) {
      const resolved = resolve(searchDirectory, `${candidate}${extension}`);
      if (isExecutableFile(resolved)) {
        return resolved;
      }
    }
  }

  return undefined;
}

export function resolveShellOption(
  shell: boolean | string | undefined,
  options: ShellResolutionOptions = {}
): boolean | string {
  if (shell === undefined || typeof shell === 'boolean') {
    return shell === undefined ? true : shell;
  }

  const candidate = shell.trim();
  if (!candidate) {
    throw new Error(
      `Invalid shell "${shell}": expected the path or name of a shell executable without arguments`
    );
  }

  if (isAbsolute(candidate)) {
    if (!isExecutableFile(candidate)) {
      throw new Error(`Invalid shell "${shell}": not an executable file`);
    }
    return candidate;
  }

  if (UNSAFE_BARE_NAME_CHARS.test(candidate)) {
    throw new Error(
      `Invalid shell "${shell}": expected the path or name of a shell executable without arguments`
    );
  }

  // Bare names (e.g. "bash", "powershell.exe") are resolved against the PATH
  // supplied to the child, not the server's own PATH.
  const resolved = resolveBareShell(candidate, options);

  if (!resolved) {
    throw new Error(`Invalid shell "${shell}": not found on PATH; use an absolute path`);
  }
  return resolved;
}
