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
    /**
     * Create an empty queue-backed buffer. Absolute byte offsets let appends track
     * capacity and line boundaries without re-encoding the retained output.
     */
    private createOutputBuffer;
    /**
     * Append a chunk while keeping the retained output under `outputBufferBytes`.
     * Each append encodes and scans only the new chunk; queue removal is amortized
     * across chunks that are discarded. The return value is the number of bytes
     * dropped from the front.
     */
    private appendCapped;
    /** Drop through an absolute byte offset, optionally aligning to a UTF-8 boundary. */
    private dropBufferPrefix;
    /** Join retained chunks only when a caller reads, then clear the queue. */
    private consumeBuffer;
    private resetBuffer;
    /** Periodically release consumed array slots while keeping appends amortized O(1). */
    private compactBufferMetadata;
    private cleanupExpiredSessions;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=interactive-session-manager.d.ts.map