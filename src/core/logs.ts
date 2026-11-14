import { stripAnsi } from './ports';

/**
 * Appends process output to a log the way a terminal would show it.
 *
 * Progress bars redraw a line by sending "\r" and then the new text. A lone
 * "\r" therefore means "the next text replaces this line", while "\r\n" (even
 * split across two chunks) is just a line break.
 */
export type LogState = { text: string; pendingCR: boolean };

export const EMPTY_LOG: LogState = { text: '', pendingCR: false };

export function appendOutput(log: LogState, chunk: string, maxLength: number): LogState {
  let { text, pendingCR } = log;
  for (const piece of stripAnsi(chunk).split(/(\r\n|\n|\r)/)) {
    if (piece === '') continue;
    if (piece === '\n' || piece === '\r\n') {
      text += '\n';
      pendingCR = false;
    } else if (piece === '\r') {
      pendingCR = true;
    } else {
      if (pendingCR) text = text.slice(0, text.lastIndexOf('\n') + 1); // overwrite the line
      text += piece;
      pendingCR = false;
    }
  }
  return { text: text.length > maxLength ? text.slice(-maxLength) : text, pendingCR };
}
