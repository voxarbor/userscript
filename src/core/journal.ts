// The script's diagnostic journal: what happened and when, kept in memory for «Копіювати журнал» (the settings).
// The owner sends it when the voice-over misbehaves: it shows every step of a switching on with its time.

const KEEP = 700; // lines kept in all
const HEAD = 250; // the first lines of the last switching on stay however much comes after them

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

export class Journal {
  private readonly lines: { text: string; keep: boolean }[] = [];
  private head = 0;
  private last = 0;

  /** now: the clock (ms); echo: gets every line as it is written (the console, when the viewer asked for it). */
  constructor(
    private readonly now: () => number = Date.now,
    private readonly echo: (line: string) => void = () => {},
  ) {}

  /** A switching on begins: its first lines are kept, those of the one before no longer. */
  begin(what: string): void {
    for (const line of this.lines) line.keep = false;
    this.head = HEAD;
    this.mark('── ' + what);
  }

  /** A line: the time of day, the milliseconds since the line before, and what happened. */
  mark(what: string): void {
    const at = this.now();
    const d = new Date(at);
    const step = this.last ? Math.round(at - this.last) : 0;
    this.last = at;
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
    const text = `${time} +${String(step).padStart(5)}  ${what}`;
    this.lines.push({ text, keep: this.head-- > 0 });
    if (this.lines.length > KEEP) {
      const spare = this.lines.findIndex((line) => !line.keep);
      this.lines.splice(spare < 0 ? 0 : spare, 1);
    }
    this.echo(text);
  }

  /** The journal as text, under the lines of `about` (the script, the browser, the settings). */
  text(about: string[] = []): string {
    return [...about, ...this.lines.map((line) => line.text)].join('\n') + '\n';
  }
}
