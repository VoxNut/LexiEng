import { ScanStats, Settings, Theme } from '../shared/types';
import { formatNumber } from '../shared/util';

export interface StatusBarActions {
  parse(): Promise<unknown>;
  reader(): Promise<unknown>;
  review(): Promise<unknown>;
  clear(): void;
  settings(): void;
}

export class StatusBar {
  private readonly host = document.createElement('aside');
  private readonly bar = document.createElement('div');
  private readonly launcher = document.createElement('button');
  private readonly coverage = document.createElement('button');
  private readonly progress = document.createElement('span');
  private readonly statsPanel = document.createElement('div');
  private readonly reviewButton: HTMLButtonElement;
  private settings?: Settings;
  private hideTimer?: number;
  private visible = true;

  public constructor(private readonly actions: StatusBarActions) {
    this.host.id = 'lexieng-status-host';
    this.host.dataset.lexiengIgnore = 'true';
    this.host.setAttribute('aria-label', 'LexiEng reading status');
    const shadow = this.host.attachShadow({ mode: 'open' });
    shadow.append(
      stylesheet('styles/base.css'),
      stylesheet('styles/status-bar.css'),
    );

    this.bar.className = 'lexieng-status-bar';
    this.bar.addEventListener('pointerenter', () => this.cancelHide());
    this.bar.addEventListener('pointerleave', () => this.scheduleHide());

    const brand = document.createElement('strong');
    brand.className = 'lexieng-status-brand';
    brand.textContent = 'LexiEng';

    this.coverage.className = 'lexieng-status-coverage';
    this.coverage.type = 'button';
    this.coverage.textContent = 'Ready';
    this.coverage.title = 'Show reading statistics';
    this.coverage.addEventListener('click', () => {
      this.statsPanel.toggleAttribute('data-open');
    });

    this.progress.className = 'lexieng-status-progress';
    this.progress.textContent = 'Alt+P to parse';

    const controls = document.createElement('div');
    controls.className = 'lexieng-status-actions';
    controls.append(
      actionButton('Parse', 'Parse page (Alt+P)', () => this.actions.parse()),
      actionButton('Reader', 'Reader mode (Alt+H)', () => this.actions.reader()),
    );
    this.reviewButton = actionButton('Review', 'Review visible Anki cards as Good', () =>
      this.actions.review(),
    );
    this.reviewButton.hidden = true;
    controls.append(
      this.reviewButton,
      actionButton('Clear', 'Clear parsed words', () => this.actions.clear()),
      actionButton('Settings', 'Open LexiEng settings', () => this.actions.settings()),
      actionButton('Hide', 'Hide status bar (Alt+S)', () => this.hide()),
    );

    this.statsPanel.className = 'lexieng-status-stats';
    this.statsPanel.setAttribute('role', 'status');
    this.bar.append(brand, this.coverage, this.progress, controls, this.statsPanel);

    this.launcher.type = 'button';
    this.launcher.className = 'lexieng-status-launcher';
    this.launcher.textContent = 'Lx';
    this.launcher.title = 'Show LexiEng status bar';
    this.launcher.hidden = true;
    this.launcher.addEventListener('click', () => this.show());

    shadow.append(this.bar, this.launcher);
    if (window === window.top) document.documentElement.append(this.host);
  }

  public get isVisible(): boolean {
    return this.visible;
  }

  public applySettings(settings: Settings): void {
    this.settings = settings;
    this.host.dataset.theme = settings.theme;
    this.bar.dataset.theme = settings.theme;
    this.launcher.dataset.theme = settings.theme;
    this.host.dataset.position = settings.statusBarPosition;
    this.host.hidden = !settings.statusBarEnabled;
    if (!settings.statusBarEnabled) return;
    if (settings.statusBarAutoHide) this.scheduleHide();
    else this.cancelHide();
  }

  public applyTheme(theme: Theme): void {
    this.host.dataset.theme = theme;
    this.bar.dataset.theme = theme;
    this.launcher.dataset.theme = theme;
  }

  public update(stats: ScanStats | undefined, parsing: boolean): void {
    if (parsing) {
      this.progress.textContent = 'Parsing…';
      this.coverage.textContent = stats ? `${Math.round(stats.coverage)}%` : 'Working';
      return;
    }
    if (!stats) {
      this.coverage.textContent = 'Ready';
      this.progress.textContent = 'Alt+P to parse';
      this.reviewButton.hidden = true;
      this.statsPanel.replaceChildren();
      return;
    }

    this.coverage.textContent = `${formatPercent(stats.coverage)} coverage`;
    this.progress.textContent = `${formatNumber(stats.targets)} targets · ${formatNumber(stats.unique)} unique`;
    this.reviewButton.hidden =
      (stats.states.new ?? 0) +
        (stats.states.learning ?? 0) +
        (stats.states.young ?? 0) +
        (stats.states.mature ?? 0) +
        (stats.states.due ?? 0) ===
      0;
    this.renderStats(stats);
    if (this.settings?.statusBarAutoHide) this.scheduleHide();
  }

  public toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  public show(): void {
    this.visible = true;
    this.bar.hidden = false;
    this.launcher.hidden = true;
    this.cancelHide();
    if (this.settings?.statusBarAutoHide) this.scheduleHide();
  }

  public hide(): void {
    this.visible = false;
    this.bar.hidden = true;
    this.launcher.hidden = false;
    this.statsPanel.removeAttribute('data-open');
    this.cancelHide();
  }

  private renderStats(stats: ScanStats): void {
    const rows: Array<[string, string]> = [
      ['Coverage', `${formatPercent(stats.coverage)} · unique ${formatPercent(stats.uniqueCoverage)}`],
      ['Words', `${formatNumber(stats.total)} · ${formatNumber(stats.unique)} unique`],
      ['Known', `${formatNumber(stats.known)} · ${formatNumber(stats.knownAnki)} Anki`],
      ['Targets', formatNumber(stats.targets)],
      ['New / learning', `${formatNumber(stats.states.new ?? 0)} / ${formatNumber(stats.states.learning ?? 0)}`],
      ['Due', formatNumber(stats.states.due ?? 0)],
      ['Young / mature', `${formatNumber(stats.states.young ?? 0)} / ${formatNumber(stats.states.mature ?? 0)}`],
      ['Frequency-known', formatNumber(stats.knownFrequency)],
    ];
    this.statsPanel.replaceChildren(
      ...rows.map(([label, value]) => {
        const row = document.createElement('div');
        const key = document.createElement('span');
        const content = document.createElement('strong');
        key.textContent = label;
        content.textContent = value;
        row.append(key, content);
        return row;
      }),
    );
  }

  private scheduleHide(): void {
    if (!this.settings?.statusBarAutoHide || !this.visible) return;
    this.cancelHide();
    this.hideTimer = window.setTimeout(() => this.hide(), 2200);
  }

  private cancelHide(): void {
    if (this.hideTimer !== undefined) window.clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
  }
}

function actionButton(
  label: string,
  title: string,
  handler: () => void | Promise<unknown>,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', () => void handler());
  return button;
}

function stylesheet(path: string): HTMLLinkElement {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = chrome.runtime.getURL(path);
  return link;
}

function formatPercent(value: number): string {
  return `${value.toFixed(value >= 99.95 ? 0 : 1)}%`;
}
