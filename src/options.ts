import { inspectAnki, loadAnkiKnownWords } from './shared/anki';
import {
  addImportBatch,
  deleteDictionary,
  getStorageStats,
  listDictionaries,
  putDictionary,
  removeDictionaryWithSameIdentity,
  replaceAnkiKnownWords,
  updateDictionary,
} from './shared/db';
import { applyTheme, getSettings, saveSettings } from './shared/settings';
import { DictionaryRecord, MetaRecord, Settings, TermRecord, Theme } from './shared/types';
import { asErrorMessage, formatNumber } from './shared/util';

interface WorkerMetadata {
  title: string;
  revision: string;
  format: number;
  sequenced: boolean;
  author?: string;
  url?: string;
  description?: string;
  attribution?: string;
  stylesheet?: string;
  bankCount: number;
}

type WorkerOutput =
  | { type: 'metadata'; jobId: string; fileName: string; metadata: WorkerMetadata }
  | {
      type: 'batch';
      jobId: string;
      kind: 'terms' | 'metadata';
      records: Array<Omit<TermRecord, 'dictionaryId'> | Omit<MetaRecord, 'dictionaryId'>>;
      progress: number;
      emittedRows: number;
    }
  | { type: 'done'; jobId: string; emittedRows: number }
  | { type: 'error'; jobId: string; message: string };

const filesInput = requiredElement<HTMLInputElement>('dictionary-files');
const dropZone = requiredElement<HTMLElement>('drop-zone');
const importPanel = requiredElement<HTMLElement>('import-panel');
const importTitle = requiredElement<HTMLElement>('import-title');
const importDetail = requiredElement<HTMLElement>('import-detail');
const importProgress = requiredElement<HTMLProgressElement>('import-progress');
const dictionaryList = requiredElement<HTMLElement>('dictionary-list');
const ankiUrl = requiredElement<HTMLInputElement>('anki-url');
const ankiDeck = requiredElement<HTMLInputElement>('anki-deck');
const ankiField = requiredElement<HTMLSelectElement>('anki-field');
const ankiStatus = requiredElement<HTMLElement>('anki-status');
const testAnkiButton = requiredElement<HTMLButtonElement>('test-anki');
const syncAnkiButton = requiredElement<HTMLButtonElement>('sync-anki');
const frequencyDictionary = requiredElement<HTMLSelectElement>('frequency-dictionary');
const knownFrequencyCeiling = requiredElement<HTMLInputElement>('known-frequency-ceiling');
const frequencyMin = requiredElement<HTMLInputElement>('frequency-min');
const frequencyMax = requiredElement<HTMLInputElement>('frequency-max');
const highlightUnranked = requiredElement<HTMLInputElement>('highlight-unranked');
const globalStatus = requiredElement<HTMLElement>('global-status');

let dictionaries: DictionaryRecord[] = [];
let importing = false;

void initialize();

filesInput.addEventListener('change', () => {
  void importFiles([...(filesInput.files ?? [])]);
  filesInput.value = '';
});

for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.dataset.dragging = 'true';
  });
}

for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    delete dropZone.dataset.dragging;
  });
}

dropZone.addEventListener('drop', (event) => {
  const files = [...(event.dataTransfer?.files ?? [])].filter(
    (file) => file.name.toLowerCase().endsWith('.zip'),
  );
  void importFiles(files);
});

dropZone.addEventListener('click', () => filesInput.click());
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    filesInput.click();
  }
});

testAnkiButton.addEventListener('click', () => void testAnkiConnection());
syncAnkiButton.addEventListener('click', () => void syncAnki());
requiredElement<HTMLButtonElement>('save-frequency').addEventListener('click', () => void saveFrequency());

for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="theme"]')) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    const theme = radio.value as Theme;
    applyTheme(theme);
    void saveSettings({ theme });
  });
}

async function initialize(): Promise<void> {
  const settings = await getSettings();
  applyTheme(settings.theme);
  populateSettings(settings);
  await navigator.storage.persist?.().catch(() => false);
  await refreshDictionaries();
  await refreshSummary();
  setupSectionTracking();
}

function populateSettings(settings: Settings): void {
  ankiUrl.value = settings.ankiUrl;
  ankiDeck.value = settings.ankiDeck;
  ankiField.dataset.savedValue = settings.ankiField;
  knownFrequencyCeiling.value = String(settings.knownFrequencyCeiling);
  frequencyMin.value = String(settings.frequencyMin);
  frequencyMax.value = String(settings.frequencyMax);
  frequencyDictionary.value = settings.frequencyDictionaryId;
  highlightUnranked.checked = settings.highlightUnranked;
  document.querySelector<HTMLInputElement>(`input[name="theme"][value="${settings.theme}"]`)?.click();
}

async function importFiles(files: File[]): Promise<void> {
  if (importing || files.length === 0) return;
  const archives = files.filter((file) => file.name.toLowerCase().endsWith('.zip'));
  if (archives.length === 0) {
    setGlobalStatus('Choose one or more .zip dictionary archives', 'error');
    return;
  }

  importing = true;
  importPanel.hidden = false;
  filesInput.disabled = true;
  const failures: string[] = [];
  for (let index = 0; index < archives.length; index += 1) {
    const file = archives[index];
    if (!file) continue;
    importTitle.textContent = `Importing ${file.name}`;
    importDetail.textContent = `Archive ${index + 1} of ${archives.length}`;
    importProgress.value = 0;
    try {
      await importFile(file, index, archives.length);
    } catch (error) {
      failures.push(`${file.name}: ${asErrorMessage(error)}`);
    }
  }

  importing = false;
  filesInput.disabled = false;
  importProgress.value = 100;
  importTitle.textContent = failures.length ? 'Import finished with errors' : 'Import complete';
  importDetail.textContent = failures.length
    ? failures.join(' · ')
    : `${archives.length} ${archives.length === 1 ? 'archive' : 'archives'} processed`;
  setGlobalStatus(
    failures.length ? `${failures.length} import failed` : 'Dictionaries are ready',
    failures.length ? 'error' : 'success',
  );
  await refreshDictionaries();
  await refreshSummary();
}

function importFile(file: File, fileIndex: number, totalFiles: number): Promise<void> {
  const jobId = crypto.randomUUID();
  const worker = new Worker(chrome.runtime.getURL('dictionary-worker.js'), { type: 'module' });
  let dictionary: DictionaryRecord | undefined;
  let termCount = 0;
  let metaCount = 0;
  const modes = new Set<string>();

  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<WorkerOutput>) => {
      void handleWorkerMessage(event.data).catch(fail);
    };
    worker.onerror = (event) => fail(new Error(event.message || 'Dictionary worker crashed'));

    void file.arrayBuffer().then((bytes) => {
      worker.postMessage({ type: 'import', jobId, fileName: file.name, bytes }, [bytes]);
    }, fail);

    async function handleWorkerMessage(message: WorkerOutput): Promise<void> {
      if (message.jobId !== jobId) return;
      if (message.type === 'metadata') {
        await removeDictionaryWithSameIdentity(message.metadata.title, message.metadata.revision);
        dictionary = {
          id: jobId,
          ...message.metadata,
          enabled: true,
          importedAt: Date.now(),
          importComplete: false,
          termCount: 0,
          metaCount: 0,
          modes: [],
          sourceFile: file.name,
        };
        await putDictionary(dictionary);
        acknowledge();
        return;
      }
      if (message.type === 'batch') {
        if (!dictionary) throw new Error('Dictionary metadata was not received before its banks');
        await addImportBatch(dictionary.id, message.kind, message.records);
        if (message.kind === 'terms') termCount += message.records.length;
        else {
          metaCount += message.records.length;
          for (const record of message.records as Array<Omit<MetaRecord, 'dictionaryId'>>) {
            if (record.mode) modes.add(record.mode);
          }
        }
        const overall = ((fileIndex + message.progress) / totalFiles) * 100;
        importProgress.value = Math.max(0, Math.min(100, overall));
        importDetail.textContent = `${formatNumber(message.emittedRows)} rows · archive ${fileIndex + 1} of ${totalFiles}`;
        acknowledge();
        return;
      }
      if (message.type === 'done') {
        if (!dictionary) throw new Error('Dictionary contained no metadata');
        await updateDictionary(dictionary.id, {
          importComplete: true,
          termCount,
          metaCount,
          modes: [...modes],
        });
        worker.terminate();
        resolve();
        return;
      }
      throw new Error(message.message);
    }

    function acknowledge(): void {
      worker.postMessage({ type: 'ack', jobId });
    }

    function fail(error: unknown): void {
      worker.terminate();
      if (dictionary) void deleteDictionary(dictionary.id).finally(() => reject(error));
      else reject(error);
    }
  });
}

async function refreshDictionaries(): Promise<void> {
  dictionaries = await listDictionaries();
  dictionaryList.replaceChildren();
  const template = requiredElement<HTMLTemplateElement>('dictionary-row-template');
  for (const dictionary of dictionaries) {
    const fragment = template.content.cloneNode(true) as DocumentFragment;
    const row = requiredFromFragment<HTMLElement>(fragment, '.dictionary-row');
    const enabled = requiredFromFragment<HTMLInputElement>(fragment, '.dictionary-enabled');
    const title = requiredFromFragment<HTMLElement>(fragment, '.dictionary-copy strong');
    const subtitle = requiredFromFragment<HTMLElement>(fragment, '.dictionary-copy span');
    const stats = requiredFromFragment<HTMLElement>(fragment, '.dictionary-stats');
    const remove = requiredFromFragment<HTMLButtonElement>(fragment, '.dictionary-delete');
    row.dataset.dictionaryId = dictionary.id;
    enabled.checked = dictionary.enabled;
    title.textContent = dictionary.title;
    subtitle.textContent = `${dictionary.revision} · Yomitan format ${dictionary.format}`;
    stats.textContent = dictionary.importComplete
      ? `${formatNumber(dictionary.termCount + dictionary.metaCount)} rows`
      : 'Incomplete import';
    enabled.addEventListener('change', () => {
      void updateDictionary(dictionary.id, { enabled: enabled.checked }).then(refreshDictionaries);
    });
    remove.addEventListener('click', () => void removeDictionary(dictionary));
    dictionaryList.append(fragment);
  }
  await refreshFrequencyDictionaries();
}

async function removeDictionary(dictionary: DictionaryRecord): Promise<void> {
  const confirmed = confirm(
    `Remove “${dictionary.title}” (${dictionary.revision}) and all ${formatNumber(dictionary.termCount + dictionary.metaCount)} imported rows?`,
  );
  if (!confirmed) return;
  setGlobalStatus(`Removing ${dictionary.title}…`, 'working');
  await deleteDictionary(dictionary.id);
  const settings = await getSettings();
  if (settings.frequencyDictionaryId === dictionary.id) {
    await saveSettings({ frequencyDictionaryId: '' });
  }
  await refreshDictionaries();
  await refreshSummary();
  setGlobalStatus(`${dictionary.title} removed`, 'success');
}

async function refreshFrequencyDictionaries(): Promise<void> {
  const settings = await getSettings();
  const available = dictionaries.filter(
    (dictionary) => dictionary.importComplete && dictionary.modes.includes('freq'),
  );
  frequencyDictionary.replaceChildren(new Option('Best available frequency list', ''));
  for (const dictionary of available) {
    frequencyDictionary.append(new Option(`${dictionary.title} · ${dictionary.revision}`, dictionary.id));
  }
  frequencyDictionary.value = available.some(({ id }) => id === settings.frequencyDictionaryId)
    ? settings.frequencyDictionaryId
    : '';
}

async function testAnkiConnection(): Promise<void> {
  setAnkiBusy(true);
  setAnkiStatus('Connecting to Anki…', 'working');
  try {
    const settings = await saveAnkiSettings();
    const inspection = await inspectAnki(settings.ankiUrl, settings.ankiDeck);
    populateAnkiChoices(inspection.decks, inspection.fields, settings.ankiField);
    const deckMessage = inspection.decks.includes(settings.ankiDeck)
      ? `${formatNumber(inspection.noteCount)} notes found in ${settings.ankiDeck}`
      : `Connected, but “${settings.ankiDeck}” was not found`;
    setAnkiStatus(`AnkiConnect v${inspection.version} · ${deckMessage}`, inspection.decks.includes(settings.ankiDeck) ? 'success' : 'error');
  } catch (error) {
    setAnkiStatus(ankiErrorMessage(error), 'error');
  } finally {
    setAnkiBusy(false);
  }
}

async function syncAnki(): Promise<void> {
  setAnkiBusy(true);
  setAnkiStatus('Reading English Mining…', 'working');
  try {
    const settings = await saveAnkiSettings();
    const words = await loadAnkiKnownWords(
      settings.ankiUrl,
      settings.ankiDeck,
      settings.ankiField,
      (completed, total) => {
        setAnkiStatus(`Reading notes ${formatNumber(completed)} / ${formatNumber(total)}…`, 'working');
      },
    );
    const count = await replaceAnkiKnownWords(words);
    setAnkiStatus(
      `Synced ${formatNumber(count)} unique known terms from “${settings.ankiDeck}”.`,
      'success',
    );
    await refreshSummary();
  } catch (error) {
    setAnkiStatus(ankiErrorMessage(error), 'error');
  } finally {
    setAnkiBusy(false);
  }
}

async function saveAnkiSettings(): Promise<Settings> {
  return saveSettings({
    ankiUrl: ankiUrl.value.trim(),
    ankiDeck: ankiDeck.value.trim(),
    ankiField: ankiField.value,
  });
}

function populateAnkiChoices(decks: string[], fields: string[], savedField: string): void {
  const deckList = requiredElement<HTMLDataListElement>('anki-decks');
  deckList.replaceChildren(...decks.map((deck) => new Option(deck)));
  ankiField.replaceChildren(new Option('Detect automatically', ''));
  for (const field of fields) ankiField.append(new Option(field, field));
  if (savedField && fields.includes(savedField)) ankiField.value = savedField;
}

async function saveFrequency(): Promise<void> {
  const ceiling = integerValue(knownFrequencyCeiling, 20_000);
  const minimum = Math.max(ceiling + 1, integerValue(frequencyMin, ceiling + 1));
  const maximum = Math.max(minimum, integerValue(frequencyMax, 100_000));
  knownFrequencyCeiling.value = String(ceiling);
  frequencyMin.value = String(minimum);
  frequencyMax.value = String(maximum);
  await saveSettings({
    knownFrequencyCeiling: ceiling,
    frequencyMin: minimum,
    frequencyMax: maximum,
    frequencyDictionaryId: frequencyDictionary.value,
    highlightUnranked: highlightUnranked.checked,
  });
  setGlobalStatus(
    `Saved: exclude ranks 1–${formatNumber(ceiling)}, target ${formatNumber(minimum)}–${formatNumber(maximum)}`,
    'success',
  );
}

async function refreshSummary(): Promise<void> {
  const stats = await getStorageStats();
  setText('dictionary-count', formatNumber(stats.dictionaries));
  setText('definition-count', formatNumber(stats.terms));
  setText('known-count', formatNumber(stats.knownAnki));
  const estimate = await navigator.storage.estimate?.();
  if (estimate?.usage !== undefined) {
    globalStatus.textContent = `${formatBytes(estimate.usage)} stored locally`;
  }
}

function setAnkiBusy(busy: boolean): void {
  testAnkiButton.disabled = busy;
  syncAnkiButton.disabled = busy;
  ankiUrl.disabled = busy;
  ankiDeck.disabled = busy;
  ankiField.disabled = busy;
}

function setAnkiStatus(text: string, state: 'working' | 'success' | 'error'): void {
  ankiStatus.textContent = text;
  ankiStatus.dataset.state = state;
}

function setGlobalStatus(text: string, state: 'working' | 'success' | 'error'): void {
  globalStatus.textContent = text;
  globalStatus.dataset.state = state;
}

function ankiErrorMessage(error: unknown): string {
  const message = asErrorMessage(error);
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return 'Could not reach AnkiConnect. Open Anki, confirm AnkiConnect is installed, and allow this extension origin in webCorsOriginList if AnkiConnect asks.';
  }
  return message;
}

function integerValue(input: HTMLInputElement, fallback: number): number {
  const value = Number(input.value);
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function setText(id: string, value: string): void {
  requiredElement(id).textContent = value;
}

function setupSectionTracking(): void {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('.settings-nav a')];
  const sections = [...document.querySelectorAll<HTMLElement>('.settings-section')];
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      for (const link of links) {
        link.toggleAttribute('aria-current', link.hash === `#${visible.target.id}`);
      }
    },
    { rootMargin: '-20% 0px -65% 0px', threshold: [0, 0.1, 0.5] },
  );
  sections.forEach((section) => observer.observe(section));
}

function requiredFromFragment<T extends Element>(fragment: DocumentFragment, selector: string): T {
  const element = fragment.querySelector(selector);
  if (!element) throw new Error(`Template is missing ${selector}`);
  return element as T;
}

function requiredElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
