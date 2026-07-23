import { Settings, Theme } from '../shared/types';

const REMOVED_ELEMENTS = [
  'script',
  'style',
  'noscript',
  'iframe',
  'object',
  'embed',
  'form',
  'button',
  'input',
  'select',
  'textarea',
  'nav',
  'aside',
].join(',');

const KEPT_ATTRIBUTES = new Set([
  'href',
  'src',
  'srcset',
  'alt',
  'title',
  'colspan',
  'rowspan',
  'datetime',
]);

export class ReaderView {
  private root?: HTMLElement;
  private content?: HTMLElement;
  private previousOverflow = '';

  public constructor(
    private readonly getSettings: () => Promise<Settings>,
    private readonly onParse: (root: HTMLElement) => Promise<void>,
    private readonly onClose: () => void,
  ) {}

  public get active(): boolean {
    return Boolean(this.root?.isConnected);
  }

  public get contentRoot(): HTMLElement | undefined {
    return this.content;
  }

  public async toggle(text?: string): Promise<void> {
    if (this.active) {
      this.close();
      return;
    }
    await this.open(text);
  }

  public async open(text?: string): Promise<void> {
    if (this.active) return;
    const article = text?.trim() ? fromPlainText(text) : extractArticle();
    if (!article) throw new Error('LexiEng could not find readable text on this page');

    const settings = await this.getSettings();
    const root = document.createElement('section');
    root.id = 'lexieng-reader';
    root.dataset.theme = settings.theme;
    root.setAttribute('aria-label', 'LexiEng reader mode');

    const controls = document.createElement('header');
    controls.className = 'lexieng-reader-controls';
    controls.dataset.lexiengIgnore = 'true';
    controls.append(
      controlButton('−', 'Decrease text size', () => this.changeFontSize(-1)),
      controlButton('+', 'Increase text size', () => this.changeFontSize(1)),
      controlButton('Narrow', 'Narrow reading column', () => this.changeWidth(-4)),
      controlButton('Wide', 'Widen reading column', () => this.changeWidth(4)),
      controlButton('Settings', 'Open LexiEng settings', () => chrome.runtime.openOptionsPage()),
      controlButton('Close', 'Close reader mode', () => this.close()),
    );

    const page = document.createElement('div');
    page.className = 'lexieng-reader-page';
    const heading = document.createElement('h1');
    heading.textContent = article.title;
    const content = document.createElement('article');
    content.className = 'lexieng-reader-content';
    content.append(...article.nodes);
    page.append(heading, content);
    root.append(controls, page);

    this.previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.append(root);
    this.root = root;
    this.content = content;
    this.applySettings(settings);

    await this.onParse(content);
  }

  public close(): void {
    this.root?.remove();
    this.root = undefined;
    this.content = undefined;
    document.documentElement.style.overflow = this.previousOverflow;
    this.onClose();
  }

  public applyTheme(theme: Theme): void {
    if (this.root) this.root.dataset.theme = theme;
  }

  private applySettings(settings: Settings): void {
    if (!this.root) return;
    this.root.style.setProperty('--lexieng-reader-font-size', `${settings.readerFontSize}px`);
    this.root.style.setProperty('--lexieng-reader-width', `${settings.readerWidth}rem`);
    this.root.style.setProperty('--lexieng-reader-line-height', String(settings.readerLineHeight));
  }

  private changeFontSize(delta: number): void {
    if (!this.root) return;
    const current = Number.parseFloat(
      this.root.style.getPropertyValue('--lexieng-reader-font-size'),
    );
    const next = Math.min(40, Math.max(12, (Number.isFinite(current) ? current : 20) + delta));
    this.root.style.setProperty('--lexieng-reader-font-size', `${next}px`);
  }

  private changeWidth(delta: number): void {
    if (!this.root) return;
    const current = Number.parseFloat(this.root.style.getPropertyValue('--lexieng-reader-width'));
    const next = Math.min(90, Math.max(24, (Number.isFinite(current) ? current : 46) + delta));
    this.root.style.setProperty('--lexieng-reader-width', `${next}rem`);
  }
}

interface ExtractedArticle {
  title: string;
  nodes: Node[];
}

function extractArticle(): ExtractedArticle | undefined {
  const candidates = [
    ...document.querySelectorAll<HTMLElement>('article, main, [role="main"]'),
  ].filter((element) => !element.closest('[data-lexieng-ignore], #lexieng-reader'));
  const source =
    candidates.sort(
      (left, right) => (right.textContent?.length ?? 0) - (left.textContent?.length ?? 0),
    )[0] ?? document.body;
  if (!source?.textContent?.trim()) return undefined;

  const clone = source.cloneNode(true) as HTMLElement;
  sanitize(clone);
  const title = document.querySelector('h1')?.textContent?.trim() || document.title || 'Reader';
  const firstHeading = clone.querySelector('h1');
  if (firstHeading?.textContent?.trim() === title) firstHeading.remove();
  const nodes = [...clone.childNodes];
  if (nodes.length === 0) return undefined;
  return {
    title,
    nodes,
  };
}

function fromPlainText(text: string): ExtractedArticle {
  const nodes = text
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      const paragraph = document.createElement('p');
      paragraph.textContent = block.replace(/\s*\n\s*/g, ' ');
      return paragraph;
    });
  return { title: document.title || 'Selection', nodes };
}

function sanitize(root: HTMLElement): void {
  root.querySelectorAll(REMOVED_ELEMENTS).forEach((element) => element.remove());
  for (const element of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
    for (const attribute of [...element.attributes]) {
      if (!KEPT_ATTRIBUTES.has(attribute.name.toLowerCase())) {
        element.removeAttribute(attribute.name);
      }
    }
    if (element instanceof HTMLAnchorElement) {
      element.target = '_blank';
      element.rel = 'noreferrer noopener';
    }
  }
}

function controlButton(
  label: string,
  title: string,
  handler: () => void | Promise<void>,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', () => void handler());
  return button;
}
