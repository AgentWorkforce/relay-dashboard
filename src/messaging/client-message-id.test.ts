import { afterEach, expect, it, vi } from "vitest";
import { createClientMessageId } from "./client-message-id";

afterEach(() => vi.unstubAllGlobals());

it("uses browser randomness when randomUUID is absent and gives distinct request ids", () => {
  let sequence = 0;
  const getRandomValues = vi.fn((bytes: Uint8Array) => {
    bytes.fill(++sequence);
    return bytes;
  });
  vi.stubGlobal("crypto", { getRandomValues });
  const first = createClientMessageId();
  const second = createClientMessageId();
  expect(first).toMatch(/^ui-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(second).not.toBe(first);
  expect(getRandomValues).toHaveBeenCalledTimes(2);
});
