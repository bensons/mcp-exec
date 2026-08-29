/**
 * Terminal Viewer Service - HTTP/WebSocket server for terminal viewing
 */
import { TerminalViewerConfig, TerminalSession, TerminalViewerStatus } from './types';
export declare class TerminalViewerService {
    private static readonly AUTH_RATE_LIMIT_WINDOW_MS;
    private static readonly AUTH_FAILURE_LIMIT;
    private static readonly MAX_TRACKED_WEBSOCKET_CLIENTS;
    private app;
    private server?;
    private wss?;
    private config;
    private sessions;
    private connections;
    private isRunning;
    private startTime?;
    private websocketAuthFailures;
    private lastWebSocketAuthPrune;
    constructor(config: TerminalViewerConfig);
    /** Constant-time token comparison; false unless a token is configured. */
    private tokenMatches;
    /** Accepts `Authorization: Bearer <token>` or `?token=<token>`. */
    private isAuthorized;
    /** Parse the fixed Bearer prefix in linear time without a backtracking expression. */
    private parseBearerToken;
    /** `?token=...` suffix for generated URLs, empty when auth is off. */
    private tokenQuery;
    private sessionUrl;
    private static isLoopbackHost;
    /** Reject configurations that would expose an unauthenticated viewer externally. */
    static assertSafeConfiguration(config: Pick<TerminalViewerConfig, 'host' | 'enableAuth'>): void;
    /** Count failed WebSocket authentication attempts per peer and bound retained state. */
    private registerWebSocketAuthFailure;
    private setupRoutes;
    private escapeHtml;
    private serializeForInlineScript;
    private generateTerminalHTML;
    start(): Promise<void>;
    stop(): Promise<void>;
    private setupWebSocketHandlers;
    private sendBufferToConnection;
    private handleWebSocketMessage;
    addSession(session: TerminalSession): void;
    removeSession(sessionId: string): void;
    hasSession(sessionId: string): boolean;
    sendInput(sessionId: string, input: string, addNewline?: boolean): void;
    private broadcastToSession;
    private broadcastStatusToSession;
    getStatus(): TerminalViewerStatus;
    isEnabled(): boolean;
    getSessionUrl(sessionId: string): string | null;
}
//# sourceMappingURL=viewer-service.d.ts.map