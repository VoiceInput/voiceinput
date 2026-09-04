import type { VoiceInputTextSelection } from "./types.js";

export interface HistoryValue {
  readonly value: string;
  readonly selection: VoiceInputTextSelection | null;
}

interface Transaction {
  before: HistoryValue;
  after: HistoryValue;
  key: string;
  at: number;
}

/** History belongs to one attachment, never to a provider or recording. */
export class TextHistory {
  #past: Transaction[] = [];
  #future: Transaction[] = [];
  #group = 0;

  clear(): void {
    this.#past = [];
    this.#future = [];
    this.breakGroup();
  }

  breakGroup(): void {
    this.#group += 1;
  }

  record(before: HistoryValue, after: HistoryValue, key: string): void {
    if (before.value === after.value) return;
    const now = Date.now();
    const groupedKey = `${this.#group}:${key}`;
    const last = this.#past.at(-1);
    const coalesce =
      last?.key === groupedKey &&
      last.after.value === before.value &&
      (key.startsWith("voice:") ||
        key === "composition" ||
        now - last.at < 1_000);
    if (coalesce && last) {
      last.after = after;
      last.at = now;
      if (last.before.value === last.after.value) this.#past.pop();
    } else {
      this.#past.push({ before, after, key: groupedKey, at: now });
    }
    this.#future = [];
    while (this.#past.length > 100 || this.#retainedBytes() > 2 * 1024 * 1024) {
      this.#past.shift();
    }
  }

  undo(): HistoryValue | undefined {
    this.breakGroup();
    const entry = this.#past.pop();
    if (!entry) return undefined;
    this.#future.push(entry);
    return entry.before;
  }

  redo(): HistoryValue | undefined {
    this.breakGroup();
    const entry = this.#future.pop();
    if (!entry) return undefined;
    this.#past.push(entry);
    return entry.after;
  }

  #retainedBytes(): number {
    return this.#past.reduce(
      (bytes, item) =>
        bytes + 2 * (item.before.value.length + item.after.value.length),
      0,
    );
  }
}
