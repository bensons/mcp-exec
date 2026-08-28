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
import { delimiter, isAbsolute, join } from 'path';

// Anything that could smuggle arguments or shell syntax into the spawned shell.
const UNSAFE_SHELL_CHARS = /[\s;&|<>$`"'()]/;

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

export function resolveShellOption(shell: boolean | string | undefined): boolean | string {
  if (shell === undefined || typeof shell === 'boolean') {
    return shell === undefined ? true : shell;
  }

  const candidate = shell.trim();
  if (!candidate || UNSAFE_SHELL_CHARS.test(candidate)) {
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

  // Bare name (e.g. "bash", "powershell.exe"): resolve against PATH so we only ever
  // hand spawn a verified executable.
  const resolved = (process.env.PATH || '')
    .split(delimiter)
    .filter(Boolean)
    .map((dir) => join(dir, candidate))
    .find(isExecutableFile);

  if (!resolved) {
    throw new Error(`Invalid shell "${shell}": not found on PATH; use an absolute path`);
  }
  return resolved;
}
