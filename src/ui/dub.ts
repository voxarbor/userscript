// The question before voicing a video that already has YouTube's own Ukrainian audio track.
import { choice, openDialog } from './dialog';
import { el } from './dom';

export class DubQuestion {
  private dialog: HTMLElement | null = null;

  /** The question is on the screen, not answered yet. */
  get asked(): boolean {
    return !!this.dialog;
  }

  /** Shows the question. onAnswer(go): «Озвучити» or not, called after the dialog is gone. */
  ask(onAnswer: (go: boolean) => void): void {
    const done = (go: boolean): void => {
      this.drop();
      onAnswer(go);
    };
    const go = choice('Озвучити', () => done(true), true);
    this.dialog = openDialog([
      el('div', { textContent: 'У цього відео вже є українська доріжка від YouTube. Все одно озвучити?' }),
      el('div', { style: 'display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:14px' },
        choice('Скасувати', () => done(false)), go)], () => done(false));
    go.focus();
  }

  /** Takes the question away unanswered. */
  drop(): void {
    if (this.dialog) this.dialog.remove();
    this.dialog = null;
  }
}
