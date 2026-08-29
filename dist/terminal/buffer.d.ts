/**
 * Raw terminal output buffer: a byte-capped ring of unmodified PTY chunks.
 * Shared by TerminalSessionManager and TerminalViewerService so replay and
 * trimming behave identically no matter which one owns the PTY handlers.
 */
import { TerminalBuffer } from './types';
export declare function createTerminalBuffer(bufferSize: number): TerminalBuffer;
export declare function appendToBuffer(buffer: TerminalBuffer, data: string): void;
/** Apply a new configured capacity to a live buffer and trim it immediately. */
export declare function resizeTerminalBuffer(buffer: TerminalBuffer, bufferSize: number): void;
/** The buffered output exactly as the PTY emitted it. */
export declare function bufferText(buffer: TerminalBuffer): string;
/**
 * Human/AI readable view of the buffer, derived at read time: ANSI colours
 * stripped, carriage-return overwrites resolved, split into lines.
 */
export declare function bufferLines(buffer: TerminalBuffer): string[];
//# sourceMappingURL=buffer.d.ts.map