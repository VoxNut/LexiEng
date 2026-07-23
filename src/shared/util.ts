export function normalizeTerm(term: string): string {
  return term
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replaceAll('’', "'")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export function escapeAnkiSearch(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

export function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deduplicate<T>(values: T[]): T[] {
  return [...new Set(values)];
}
