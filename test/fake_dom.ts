// A document just big enough for the UI's builders (the tests run in Node, without a browser): elements keep
// their properties, children and listeners; nothing is laid out or drawn. An event goes to the document's
// capturing listeners first, then from its target up through the parents.

type Listener = (event: FakeEvent) => void;

interface FakeEvent {
  type: string;
  target: FakeElement;
  key?: string;
  stopped: boolean;
  stopPropagation(): void;
  preventDefault(): void;
}

class FakeText {
  parentNode: FakeElement | null = null;
  constructor(public textContent: string) {}
}

type FakeNode = FakeElement | FakeText;

export class FakeElement {
  /** Whatever else the code sets on an element (value, checked, title, onclick, …) is kept as it is. */
  [property: string]: unknown;
  parentNode: FakeElement | null = null;
  childNodes: FakeNode[] = [];
  readonly dataset: Record<string, string> = {};
  readonly attributes: Record<string, string> = {};
  private readonly css: Record<string, string> = { cssText: '' };
  private readonly listeners = new Map<string, Listener[]>();

  constructor(
    readonly tagName: string,
    private readonly doc: FakeDocument,
  ) {}

  get style(): Record<string, string> {
    return this.css;
  }

  /** As in a browser, text given to `style` becomes its cssText. */
  set style(text: string) {
    this.css.cssText = text;
  }

  get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join('');
  }

  set textContent(text: string) {
    this.replaceChildren(text);
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((n): n is FakeElement => n instanceof FakeElement);
  }

  get parentElement(): FakeElement | null {
    return this.parentNode;
  }

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }

  get isConnected(): boolean {
    return this.doc.body.contains(this);
  }

  append(...kids: (FakeNode | string)[]): void {
    for (const kid of kids) {
      const node = typeof kid === 'string' ? new FakeText(kid) : kid;
      if (node instanceof FakeElement) node.remove();
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }

  prepend(kid: FakeElement): void {
    kid.remove();
    kid.parentNode = this;
    this.childNodes.unshift(kid);
  }

  /** Puts the element into this one's parent, right before it. */
  before(kid: FakeElement): void {
    kid.remove();
    const siblings = this.parentNode!.childNodes;
    kid.parentNode = this.parentNode;
    siblings.splice(siblings.indexOf(this), 0, kid);
  }

  replaceChildren(...kids: (FakeNode | string)[]): void {
    for (const old of this.childNodes) old.parentNode = null;
    this.childNodes = [];
    this.append(...kids);
  }

  remove(): void {
    const siblings = this.parentNode ? this.parentNode.childNodes : [];
    if (siblings.includes(this)) siblings.splice(siblings.indexOf(this), 1);
    this.parentNode = null;
  }

  contains(other: FakeElement | null): boolean {
    for (let e = other; e; e = e.parentNode) if (e === this) return true;
    return false;
  }

  /** The nearest element of the tag, from this one up (the only kind of selector the UI uses). */
  closest(tag: string): FakeElement | null {
    for (let e: FakeElement | null = this; e; e = e.parentNode) if (e.tagName === tag) return e;
    return null;
  }

  /** Every element of the tag inside this one, in the order of the page. */
  all(tag: string): FakeElement[] {
    return this.children.flatMap((c) => (c.tagName === tag ? [c] : []).concat(c.all(tag)));
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
    if (name === 'style') for (const key of Object.keys(this.css)) delete this.css[key];
  }

  focus(): void {
    this.doc.activeElement = this;
  }

  /** As in a browser, a listener given with a signal goes away when the signal is aborted. */
  addEventListener(type: string, listener: Listener, options?: { signal?: AbortSignal }): void {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
    options?.signal?.addEventListener('abort', () => this.removeEventListener(type, listener));
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((l) => l !== listener));
  }

  /** Sends an event of the type from this element, as the browser would after the user's action. */
  fire(type: string, init: { key?: string } = {}): FakeEvent {
    const event: FakeEvent = {
      type,
      target: this,
      ...init,
      stopped: false,
      stopPropagation() {
        this.stopped = true;
      },
      preventDefault() {},
    };
    if (this.isConnected) this.doc.capture(event);
    for (let e: FakeElement | null = this; e && !event.stopped; e = e.parentNode) {
      const on = e['on' + type];
      if (typeof on === 'function') on.call(e, event);
      for (const listener of e.listeners.get(type) || []) listener(event);
    }
    return event;
  }
}

class FakeDocument {
  readonly body: FakeElement = new FakeElement('body', this);
  activeElement: FakeElement | null = null;
  /** The element shown full screen; a test sets it and fires 'fullscreenchange'. */
  fullscreenElement: FakeElement | null = null;
  /** What the page has for a selector (the adapters look their places up by selectors); a test fills it. */
  readonly found: Record<string, FakeElement | null> = {};
  private readonly capturing = new Map<string, Listener[]>();

  createElement(tag: string): FakeElement {
    return new FakeElement(tag, this);
  }

  createElementNS(_namespace: string, tag: string): FakeElement {
    return new FakeElement(tag, this);
  }

  /** The UI listens on the document only in the capture phase. */
  addEventListener(type: string, listener: Listener): void {
    this.capturing.set(type, [...(this.capturing.get(type) || []), listener]);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.capturing.set(type, (this.capturing.get(type) || []).filter((l) => l !== listener));
  }

  querySelector(selector: string): FakeElement | null {
    return this.found[selector] ?? null;
  }

  /** Sends an event of the document's own (fullscreenchange). */
  fire(type: string): void {
    this.capture({ type, target: this.body, stopped: false, stopPropagation() {}, preventDefault() {} });
  }

  capture(event: FakeEvent): void {
    for (const listener of this.capturing.get(event.type) || []) listener(event);
  }
}

/** Puts a new empty document (and `Option`) where the UI code looks for them. */
export function installDom(): FakeDocument {
  const doc = new FakeDocument();
  function Option(text = '', value = '', _defaultSelected = false, selected = false): FakeElement {
    return Object.assign(doc.createElement('option'), { textContent: text, value, selected });
  }
  Object.assign(globalThis, { document: doc, Option });
  return doc;
}

/** An element the UI built, seen as what it really is in these tests. */
export const fake = (element: unknown): FakeElement => element as FakeElement;
