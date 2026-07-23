declare module '*lexieng_core.js' {
  export default function init(options?: {
    module_or_path: string | URL | Request | BufferSource | WebAssembly.Module;
  }): Promise<WebAssembly.Exports>;

  export function tokenize_nodes(nodes: string[]): Array<{
    nodeIndex: number;
    start: number;
    end: number;
    surface: string;
    normalized: string;
    candidates: string[];
  }>;

  export function lookup_candidates(term: string): string[];

  export class YomitanArchive {
    constructor(bytes: Uint8Array);
    metadata(): {
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
    };
    next_batch(batchSize: number): {
      kind: 'terms' | 'metadata' | 'done';
      records?: unknown[];
    };
    progress(): number;
    emitted_rows(): number;
    free(): void;
  }
}
