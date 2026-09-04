import { expect, it, vi, afterEach } from "vitest";
import { TextHistory } from "./history.js";
const state = (value: string) => ({ value, selection: null });
afterEach(() => vi.useRealTimers());

it("coalesces typing and phrase revisions but separates later transactions", () => {
  vi.useFakeTimers();
  const history = new TextHistory();
  history.record(state(""), state("a"), "insertText");
  history.record(state("a"), state("ab"), "insertText");
  history.breakGroup();
  history.record(state("ab"), state("ab draft"), "voice:a");
  vi.advanceTimersByTime(5_000);
  history.record(state("ab draft"), state("ab final"), "voice:a");
  expect(history.undo()?.value).toBe("ab");
  expect(history.undo()?.value).toBe("");
  expect(history.redo()?.value).toBe("ab");
  history.record(state("ab"), state("changed"), "insertFromPaste");
  expect(history.redo()).toBeUndefined();
});

it("bounds retained transactions and does not retain oversized text", () => {
  const history = new TextHistory();
  for (let index = 0; index < 110; index++) {
    history.breakGroup();
    history.record(state(String(index)), state(String(index + 1)), "voice");
  }
  let count = 0;
  while (history.undo()) count++;
  expect(count).toBe(100);
  history.clear();
  history.record(state(""), state("x".repeat(1024 * 1024 + 1)), "voice");
  expect(history.undo()).toBeUndefined();
});
