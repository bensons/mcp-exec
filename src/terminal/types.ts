/**
 * Terminal viewer types and interfaces
 */

export interface TerminalViewerConfig {
  enabled: boolean;
  port: number;
  host: string;
  maxSessions: number;
  sessionTimeout: number; // milliseconds
  bufferSize: number; // lines
  enableAuth: boolean;
  authToken?: string;
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
  pty?: any; // IPty from node-pty
  buffer: TerminalBuffer;
  viewers: Set<string>; // WebSocket connection IDs
  aiContext?: string;
}

/**
 * Raw PTY output kept verbatim as a ring of chunks, so a viewer that connects
 * later replays exactly the byte stream the live viewer saw (partial lines,
 * carriage returns and cursor movement included).
 */
export interface TerminalBuffer {
  chunks: string[];
  bytes: number; // UTF-8 encoded size of the retained chunks
  maxBytes: number; // UTF-8 encoded capacity
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
  uptime?: number; // milliseconds
}

export interface WebSocketMessage {
  type: 'data' | 'resize' | 'status' | 'error';
  sessionId: string;
  data?: string;
  size?: { cols: number; rows: number };
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
