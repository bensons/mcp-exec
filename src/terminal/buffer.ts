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

  buffer.chunks.push(data);
  buffer.bytes += Buffer.byteLength(data, 'utf8');

  trimBuffer(buffer);
}

/** Apply a new configured capacity to a live buffer and trim it immediately. */
export function resizeTerminalBuffer(buffer: TerminalBuffer, bufferSize: number): void {
  buffer.maxBytes = Math.max(bufferSize, 1) * BYTES_PER_LINE;
  trimBuffer(buffer);
}

function trimBuffer(buffer: TerminalBuffer): void {
  while (buffer.bytes > buffer.maxBytes && buffer.chunks.length > 1) {
    buffer.bytes -= Buffer.byteLength(buffer.chunks.shift()!, 'utf8');
  }

  // A single chunk bigger than the whole cap: keep the largest tail that fits.
  // Walk Unicode code points rather than slicing UTF-16 code units so trimming
  // can never leave half of a surrogate pair in the replay stream.
  if (buffer.bytes > buffer.maxBytes) {
    const { text, bytes } = utf8Tail(buffer.chunks[0], buffer.maxBytes);
    buffer.chunks[0] = text;
    buffer.bytes = bytes;
  }
}

function utf8Tail(text: string, maxBytes: number): { text: string; bytes: number } {
  let start = text.length;
  let bytes = 0;

  while (start > 0) {
    let codePointStart = start - 1;
    const lastCodeUnit = text.charCodeAt(codePointStart);
    if (
      lastCodeUnit >= 0xdc00 &&
      lastCodeUnit <= 0xdfff &&
      codePointStart > 0
    ) {
      const precedingCodeUnit = text.charCodeAt(codePointStart - 1);
      if (precedingCodeUnit >= 0xd800 && precedingCodeUnit <= 0xdbff) {
        codePointStart--;
      }
    }

    const codePointBytes = Buffer.byteLength(text.slice(codePointStart, start), 'utf8');
    if (bytes + codePointBytes > maxBytes) break;

    bytes += codePointBytes;
    start = codePointStart;
  }

  return { text: text.slice(start), bytes };
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
  if (!text) return [];

  // A carriage return moves the cursor to column zero without clearing the
  // existing line. Later characters overwrite cells in place; a shorter
  // replacement therefore retains the untouched suffix, just like a terminal.
  const lines = text.split('\n').map(renderCarriageReturns);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function renderCarriageReturns(line: string): string {
  const cells: string[] = [];
  let cursor = 0;

  for (const character of line) {
    if (character === '\r') {
      cursor = 0;
      continue;
    }

    if (cursor < cells.length) {
      cells[cursor] = character;
    } else {
      cells.push(character);
    }
    cursor++;
  }

  return cells.join('');
}
