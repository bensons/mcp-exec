/**
 * Interactive Session Manager for handling long-running interactive processes
 */
import { InteractiveSession, SessionOutput, SessionInfo, ServerConfig } from '../types/index';
import { CommandGuard } from '../security/command-policy';
export interface StartSessionOptions {
    command: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
    shell?: boolean | string;
    aiContext?: string;
    /** Set when the command was already approved via confirm_command. */
    skipConfirmation?: boolean;
}
export interface SendInputOptions {
    sessionId: string;
    input: string;
    addNewline?: boolean;
    /** Set when the input was already approved via confirm_command. */
    skipConfirmation?: boolean;
}
/** How long a finished/errored session is kept around so its output can still be drained. */
export declare const FINISHED_SESSION_GRACE_MS: number;
export declare class InteractiveSessionManager {
    private sessions;
    private config;
    private cleanupInterval;
    private commandGuard?;
    constructor(config: ServerConfig['sessions'], commandGuard?: CommandGuard);
    /**
     * Swap in a new sessions config without recreating the manager (which would
     * orphan every running child process). Limits/timeouts are read at call time.
     */
    updateConfig(config: ServerConfig['sessions']): void;
    startSession(options: StartSessionOptions): Promise<string>;
    sendInput(options: SendInputOptions): Promise<void>;
    readOutput(sessionId: string): Promise<SessionOutput>;
    killSession(sessionId: string): Promise<void>;
    listSessions(): SessionInfo[];
    getSession(sessionId: string): InteractiveSession | undefined;
    countRunningSessions(): number;
    private setupProcessHandlers;
    private cleanupExpiredSessions;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=interactive-session-manager.d.ts.map