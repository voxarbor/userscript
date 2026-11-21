// What the server says to the person, made safe to show. It is only ever shown as plain text (textContent, a
// title), so nothing in it is markup or a link; here it also becomes one short line without control or
// direction-changing characters, so it cannot pass for something else on the page either.
const MOST = 200;

/** The server's words as one line of at most MOST characters; null when it said nothing (or not a text). */
export function said(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const line = text.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028-\u202e\u2066-\u2069\s]+/g, ' ').trim();
  return !line ? null : line.length > MOST ? line.slice(0, MOST - 1) + '…' : line;
}

/** What the server adds to its answers in the contract proposal (docs/contract-proposal.md), read when there:
 *  its words for the state of the video, and for a refusal. Until it does, the script's own few words stand. */
export interface Proposed {
  status_text?: string | null;
  message?: string | null;
  reason?: string | null;
}
