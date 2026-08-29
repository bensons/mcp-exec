/**
 * Terminal viewer types and interfaces
 */
export interface TerminalViewerConfig {
    enabled: boolean;
    port: number;
    host: string;
    maxSessions: number;
    sessionTimeout: number;
    bufferSize: number;
    enableAuth: boolean;
    authToken?: string;
    disableWebSocketBuffering?: boolean;
}
export interface TerminalSession {
    sessionId: string;
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string>;
    startTime: Date;
    lastActivity: Date;
    status: 'running' | 'finished' | 'error';
    pty?: any;
    buffer: TerminalBuffer;
    viewers: Set<string>;
    aiContext?: string;
}
export interface TerminalBuffer {
    lines: TerminalLine[];
    cursor: {
        x: number;
        y: number;
    };
    scrollback: number;
    maxLines: number;
}
export interface TerminalLine {
    text: string;
    timestamp: Date;
    type: 'input' | 'output' | 'error';
    ansiCodes?: string[];
}
export interface TerminalViewerSession {
    sessionId: string;
    url: string;
    command: string;
    startTime: Date;
    status: 'running' | 'finished' | 'error';
    viewerCount: number;
}
export interface TerminalViewerStatus {
    enabled: boolean;
    port?: number;
    host?: string;
    activeSessions: TerminalViewerSession[];
    totalSessions: number;
    uptime?: number;
}
export interface WebSocketMessage {
    type: 'data' | 'resize' | 'status' | 'error';
    sessionId: string;
    data?: string;
    size?: {
        cols: number;
        rows: number;
    };
    status?: string;
    error?: string;
    timestamp: Date;
}
export interface TerminalViewerResource {
    uri: string;
    name: string;
    description: string;
    mimeType: string;
    sessions: TerminalViewerSession[];
}
//# sourceMappingURL=types.d.ts.map