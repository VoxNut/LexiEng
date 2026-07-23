import init, { YomitanArchive } from '../.generated/wasm/lexijap_core.js';

interface ImportMessage {
  type: 'import';
  jobId: string;
  fileName: string;
  bytes: ArrayBuffer;
}

interface AcknowledgeMessage {
  type: 'ack';
  jobId: string;
}

type WorkerInput = ImportMessage | AcknowledgeMessage;

const worker = globalThis as unknown as {
  location: Location;
  onmessage: ((event: MessageEvent<WorkerInput>) => void) | null;
  postMessage(message: unknown): void;
};

let wasmReady: Promise<WebAssembly.Exports> | undefined;
const acknowledgements = new Map<string, () => void>();

worker.onmessage = (event) => {
  if (event.data.type === 'ack') {
    acknowledgements.get(event.data.jobId)?.();
    acknowledgements.delete(event.data.jobId);
    return;
  }
  void importArchive(event.data);
};

async function importArchive(message: ImportMessage): Promise<void> {
  let archive: YomitanArchive | undefined;
  try {
    wasmReady ??= init({
      module_or_path: new URL('./wasm/lexijap_core_bg.wasm', worker.location.href),
    });
    await wasmReady;
    archive = new YomitanArchive(new Uint8Array(message.bytes));
    worker.postMessage({
      type: 'metadata',
      jobId: message.jobId,
      fileName: message.fileName,
      metadata: archive.metadata(),
    });
    await waitForAcknowledgement(message.jobId);

    while (true) {
      const batch = archive.next_batch(750);
      if (batch.kind === 'done') break;
      worker.postMessage({
        type: 'batch',
        jobId: message.jobId,
        kind: batch.kind,
        records: batch.records ?? [],
        progress: archive.progress(),
        emittedRows: archive.emitted_rows(),
      });
      await waitForAcknowledgement(message.jobId);
    }

    worker.postMessage({
      type: 'done',
      jobId: message.jobId,
      emittedRows: archive.emitted_rows(),
    });
  } catch (error) {
    worker.postMessage({
      type: 'error',
      jobId: message.jobId,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    archive?.free();
  }
}

function waitForAcknowledgement(jobId: string): Promise<void> {
  return new Promise((resolve) => acknowledgements.set(jobId, resolve));
}
