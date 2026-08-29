/**
 * Shared resolution/validation of the `shell` option handed to child_process.spawn.
 *
 * Semantics:
 *   undefined -> true   (platform default shell)
 *   true      -> true   (platform default shell)
 *   false     -> false  (spawn the command directly, no shell, args stay separate)
 *   string    -> absolute path to the requested shell executable
 */
export interface ShellResolutionOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}
export declare function resolveShellOption(shell: boolean | string | undefined, options?: ShellResolutionOptions): boolean | string;
//# sourceMappingURL=shell-option.d.ts.map