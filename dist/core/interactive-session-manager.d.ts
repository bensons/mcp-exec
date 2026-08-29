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
}
export interface SendInputOptions {
    sessionId: string;
    input: string;
    addNewline?: boolean;
}
export declare class InteractiveSessionManager {
    private sessions;
    private config;
    private cleanupInterval;
    private commandGuard?;
    constructor(config: ServerConfig['sessions'], commandGuard?: CommandGuard);
    startSession(options: StartSessionOptions): Promise<string>;
    sendInput(options: SendInputOptions): Promise<void>;
    readOutput(sessionId: string): Promise<SessionOutput>;
    killSession(sessionId: string): Promise<void>;
    listSessions(): SessionInfo[];
    getSession(sessionId: string): InteractiveSession | undefined;
    private setupProcessHandlers;
    private cleanupExpiredSessions;
    shutdown(): Promise<void>;
}
//# sourceMappingURL=interactive-session-manager.d.ts.map