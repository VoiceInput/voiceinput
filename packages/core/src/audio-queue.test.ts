import { expect, it } from "vitest";
import { AudioQueue } from "./audio-queue.js";

it("keeps startup audio ordered and owned, and drains before closing", async () => {
  const queue = new AudioQueue(4);
  const input = new Int16Array([1, 2]);
  queue.push(input);
  input[0] = 99;
  queue.push(new Int16Array([3, 4]));
  queue.close();
  expect(await queue.read()).toEqual(new Int16Array([1, 2]));
  expect(await queue.read()).toEqual(new Int16Array([3, 4]));
  expect(await queue.read()).toBeUndefined();
});

it("fails before overflow and releases a waiting consumer on abort", async () => {
  const queue = new AudioQueue(2);
  queue.push(new Int16Array([1, 2]));
  expect(() => queue.push(new Int16Array([3]))).toThrow(/buffer overflowed/);
  queue.close(true);
  expect(await queue.read()).toBeUndefined();
  const empty = new AudioQueue(2);
  const pending = empty.read();
  empty.close(true);
  expect(await pending).toBeUndefined();
});
