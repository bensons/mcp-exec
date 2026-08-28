/**
 * Raw terminal output buffer: a byte-capped ring of unmodified PTY chunks.
 * Shared by TerminalSessionManager and TerminalViewerService so replay and
 * trimming behave identically no matter which one owns the PTY handlers.
 */

import { TerminalBuffer } from './types';
import { OutputProcessor } from '../utils/output-processor';

/** ~100 bytes per configured line keeps the historical `bufferSize` meaningful (10 000 lines -> 1 MB). */
const BYTES_PER_LINE = 100;

export function createTerminalBuffer(bufferSize: number): TerminalBuffer {
  return { chunks: [], bytes: 0, maxBytes: Math.max(bufferSize, 1) * BYTES_PER_LINE };
}

export function appendToBuffer(buffer: TerminalBuffer, data: string): void {
  if (!data) return;

  // ponytail: `bytes` counts UTF-16 code units, not encoded bytes - close enough
  // for a cap, and it avoids a Buffer.byteLength pass on every PTY chunk.
  buffer.chunks.push(data);
  buffer.bytes += data.length;

  while (buffer.bytes > buffer.maxBytes && buffer.chunks.length > 1) {
    buffer.bytes -= buffer.chunks.shift()!.length;
  }

  // A single chunk bigger than the whole cap: keep its tail.
  if (buffer.bytes > buffer.maxBytes) {
    const kept = buffer.chunks[0].slice(-buffer.maxBytes);
    buffer.chunks[0] = kept;
    buffer.bytes = kept.length;
  }
}

/** The buffered output exactly as the PTY emitted it. */
export function bufferText(buffer: TerminalBuffer): string {
  return buffer.chunks.join('');
}

/**
 * Human/AI readable view of the buffer, derived at read time: ANSI colours
 * stripped, carriage-return overwrites resolved, split into lines.
 */
export function bufferLines(buffer: TerminalBuffer): string[] {
  const text = OutputProcessor.stripAnsiCodes(bufferText(buffer));
  // Drop the CR of a CRLF, then keep only what survives any in-line overwrite.
  const lines = text.split('\n').map(line => line.replace(/\r$/, '').split('\r').pop()!);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
