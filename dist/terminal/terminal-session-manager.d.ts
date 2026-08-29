/**
 * Enhanced Terminal Session Manager with PTY support
 */
import { TerminalSession, TerminalBuffer } from './types';
import { StartSessionOptions, SendInputOptions } from '../core/interactive-session-manager';
import { ServerConfig } from '../types/index';
import { CommandGuard } from '../security/command-policy';
export interface TerminalStartSessionOptions extends Omit<StartSessionOptions, 'command'> {
    command?: string;
    enableTerminalViewer?: boolean;
    terminalSize?: {
        cols: number;
        rows: number;
    };
}
export declare class TerminalSessionManager {
    private sessions;
    private config;
    private terminalViewerConfig;
    private cleanupInterval;
    private fallbackSessionManager;
    private commandGuard?;
    private sessionRemovedHandler?;
    constructor(config: ServerConfig['sessions'], terminalViewerConfig: ServerConfig['terminalViewer'], commandGuard?: CommandGuard);
    /**
     * Register a callback invoked whenever a terminal session is removed from this manager
     * (kill, terminate or sweep). Used to keep the terminal viewer service in sync.
     */
    onSessionRemoved(handler: (sessionId: string) => void): void;
    startSession(options: TerminalStartSessionOptions): Promise<string>;
    private createPtyProcess;
    private getShell;
    private setupPtyHandlers;
    private addToBuffer;
    private extractAnsiCodes;
    sendInput(options: SendInputOptions): Promise<void>;
    killSession(sessionId: string): Promise<void>;
    countRunningSessions(): number;
    getSession(sessionId: string): TerminalSession | undefined;
    getSessionInfo(sessionId: string): any;
    listSessions(): Array<{
        sessionId: string;
        command: string;
        startTime: Date;
        lastActivity: Date;
        status: 'running' | 'finished' | 'error';
        cwd: string;
        aiContext?: string;
        hasTerminalViewer: boolean;
    }>;
    private cleanupExpiredSessions;
    shutdown(): Promise<void>;
    resizeTerminal(sessionId: string, cols: number, rows: number): void;
    getTerminalBuffer(sessionId: string): TerminalBuffer | null;
}
//# sourceMappingURL=terminal-session-manager.d.ts.map