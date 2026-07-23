import { applyTheme, getSettings, saveSettings } from './shared/settings';
import { PageState, RuntimeRequest, Theme } from './shared/types';
import { formatNumber } from './shared/util';

const coverage = requiredElement('coverage');
const detail = requiredElement('state-detail');
const error = requiredElement('error');
const theme = requiredElement<HTMLSelectElement>('theme');

void initialize();

requiredElement<HTMLButtonElement>('parse-page').addEventListener('click', () =>
  void perform({ type: 'scanActivePage' }, true),
);
requiredElement<HTMLButtonElement>('parse-selection').addEventListener('click', () =>
  void perform({ type: 'scanActiveSelection' }, true),
);
requiredElement<HTMLButtonElement>('reader-mode').addEventListener('click', () =>
  void perform({ type: 'openReaderActivePage' }, true),
);
requiredElement<HTMLButtonElement>('toggle-status').addEventListener('click', () =>
  void perform({ type: 'toggleStatusBarActivePage' }, true),
);
requiredElement<HTMLButtonElement>('clear-page').addEventListener('click', () =>
  void perform({ type: 'clearActivePage' }, false),
);
requiredElement<HTMLButtonElement>('open-options').addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
  window.close();
});

theme.addEventListener('change', () => {
  const selected = theme.value as Theme;
  applyTheme(selected);
  void saveSettings({ theme: selected });
});

async function initialize(): Promise<void> {
  const settings = await getSettings();
  applyTheme(settings.theme);
  theme.value = settings.theme;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  requiredElement('page-title').textContent = tab?.title ?? 'Current page';
  try {
    renderState(await sendMessage<PageState>({ type: 'getActivePageState' }));
  } catch (cause) {
    showError(errorMessage(cause));
  }
}

async function perform(message: RuntimeRequest, closeAfter: boolean): Promise<void> {
  setBusy(true);
  hideError();
  try {
    await sendMessage(message);
    if (closeAfter) {
      window.close();
      return;
    }
    renderState(await sendMessage<PageState>({ type: 'getActivePageState' }));
  } catch (cause) {
    showError(errorMessage(cause));
  } finally {
    setBusy(false);
  }
}

function renderState(state: PageState): void {
  if (!state.stats) {
    coverage.textContent = state.parsing ? 'Parsing…' : 'Not parsed';
    detail.textContent = state.readerOpen
      ? 'Reader mode is open.'
      : 'Point at a word and press Q, or parse the page.';
    return;
  }
  coverage.textContent = `${formatPercent(state.stats.coverage)} coverage`;
  detail.textContent = `${formatNumber(state.stats.targets)} targets · ${formatNumber(
    state.stats.unique,
  )} unique words`;
}

function setBusy(busy: boolean): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('button')) {
    button.disabled = busy;
  }
}

function showError(message: string): void {
  error.hidden = false;
  error.textContent = message;
}

function hideError(): void {
  error.hidden = true;
  error.textContent = '';
}

function formatPercent(value: number): string {
  return `${value.toFixed(value >= 99.95 ? 0 : 1)}%`;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function sendMessage<T = unknown>(message: RuntimeRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as T | { error?: string };
  if (response && typeof response === 'object' && 'error' in response && response.error) {
    throw new Error(response.error);
  }
  return response as T;
}

function requiredElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
