// The question before voicing a video anew in the viewer's voice when it is ready in other voices already.
import type { ReadyOffer } from '../core/ready';
import { choice, openDialog } from './dialog';
import { el } from './dom';
import { playBtn } from './widgets';

export class ReadyQuestion {
  private dialog: HTMLElement | null = null;

  /** play(path): plays a voice's sample. */
  constructor(private readonly play: (path: string) => Promise<void>) {}

  /** The question is on the screen, not answered yet. */
  get asked(): boolean {
    return !!this.dialog;
  }

  /** Shows the voices the video is ready in. onAnswer(voice): the ready voice taken for this video, or '' for
   *  «voice it anew in my own»; called after the dialog is gone, and not at all when the viewer leaves the
   *  question (Escape, «Скасувати»): then nothing starts. */
  ask({ ready, own }: ReadyOffer, onAnswer: (voice: string) => void): void {
    const done = (voice: string): void => {
      this.drop();
      onAnswer(voice);
    };
    const rows = ready.map((v) => {
      const take = choice(`${v.label} · ${Math.round(v.share * 100)} %`, () => done(v.voice), true);
      take.style.cssText += ';flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left';
      take.title = v.label;
      return el('div', { style: 'display:flex;align-items:center;gap:8px;margin-top:8px' }, take,
        playBtn('Зразок голосу', () => this.play(v.sample)));
    });
    const anew = choice('Озвучити новим: ' + own, () => done(''));
    anew.style.cssText += ';max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    anew.title = own;
    this.dialog = openDialog([
      el('div', { textContent: 'Уже озвучено цими голосами:' }),
      ...rows,
      el('div', { style: 'display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:14px' },
        choice('Скасувати', () => this.drop()), anew)], () => this.drop());
    (rows[0]!.firstChild as HTMLElement).focus();
  }

  /** Takes the question away unanswered. */
  drop(): void {
    if (this.dialog) this.dialog.remove();
    this.dialog = null;
  }
}
