"use strict";
/**
 * Raw terminal output buffer: a byte-capped ring of unmodified PTY chunks.
 * Shared by TerminalSessionManager and TerminalViewerService so replay and
 * trimming behave identically no matter which one owns the PTY handlers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTerminalBuffer = createTerminalBuffer;
exports.appendToBuffer = appendToBuffer;
exports.bufferText = bufferText;
exports.bufferLines = bufferLines;
const output_processor_1 = require("../utils/output-processor");
/** ~100 bytes per configured line keeps the historical `bufferSize` meaningful (10 000 lines -> 1 MB). */
const BYTES_PER_LINE = 100;
function createTerminalBuffer(bufferSize) {
    return { chunks: [], bytes: 0, maxBytes: Math.max(bufferSize, 1) * BYTES_PER_LINE };
}
function appendToBuffer(buffer, data) {
    if (!data)
        return;
    buffer.chunks.push(data);
    buffer.bytes += Buffer.byteLength(data, 'utf8');
    while (buffer.bytes > buffer.maxBytes && buffer.chunks.length > 1) {
        buffer.bytes -= Buffer.byteLength(buffer.chunks.shift(), 'utf8');
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
function utf8Tail(text, maxBytes) {
    let start = text.length;
    let bytes = 0;
    while (start > 0) {
        let codePointStart = start - 1;
        const lastCodeUnit = text.charCodeAt(codePointStart);
        if (lastCodeUnit >= 0xdc00 &&
            lastCodeUnit <= 0xdfff &&
            codePointStart > 0) {
            const precedingCodeUnit = text.charCodeAt(codePointStart - 1);
            if (precedingCodeUnit >= 0xd800 && precedingCodeUnit <= 0xdbff) {
                codePointStart--;
            }
        }
        const codePointBytes = Buffer.byteLength(text.slice(codePointStart, start), 'utf8');
        if (bytes + codePointBytes > maxBytes)
            break;
        bytes += codePointBytes;
        start = codePointStart;
    }
    return { text: text.slice(start), bytes };
}
/** The buffered output exactly as the PTY emitted it. */
function bufferText(buffer) {
    return buffer.chunks.join('');
}
/**
 * Human/AI readable view of the buffer, derived at read time: ANSI colours
 * stripped, carriage-return overwrites resolved, split into lines.
 */
function bufferLines(buffer) {
    const text = output_processor_1.OutputProcessor.stripAnsiCodes(bufferText(buffer));
    if (!text)
        return [];
    // A carriage return moves the cursor to column zero without clearing the
    // existing line. Later characters overwrite cells in place; a shorter
    // replacement therefore retains the untouched suffix, just like a terminal.
    const lines = text.split('\n').map(renderCarriageReturns);
    if (lines.length > 1 && lines[lines.length - 1] === '')
        lines.pop();
    return lines;
}
function renderCarriageReturns(line) {
    const cells = [];
    let cursor = 0;
    for (const character of line) {
        if (character === '\r') {
            cursor = 0;
            continue;
        }
        if (cursor < cells.length) {
            cells[cursor] = character;
        }
        else {
            cells.push(character);
        }
        cursor++;
    }
    return cells.join('');
}
//# sourceMappingURL=buffer.js.map