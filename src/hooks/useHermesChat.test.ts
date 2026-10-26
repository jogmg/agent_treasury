import { describe, expect, it } from "vitest";
import {
  createRevertSnapshot,
  messagesBeforeUserPrompt,
  messagesFromRevertSnapshot,
  messagesThroughUserPrompt,
} from "./useHermesChat";
import type { ChatMessage } from "../lib/hermes";

const messages: ChatMessage[] = [
  { role: "user", content: "First question" },
  { role: "assistant", content: "First answer" },
  { role: "user", content: "Second question" },
  { role: "assistant", content: "Second answer" },
  { role: "user", content: "Third question" },
];

describe("Hermes prompt history actions", () => {
  it("keeps the selected prompt and prior context for resend", () => {
    expect(messagesThroughUserPrompt(messages, 2)).toEqual(
      messages.slice(0, 3)
    );
  });

  it("removes the selected prompt and later turns when reverting to edit it", () => {
    expect(messagesBeforeUserPrompt(messages, 2)).toEqual(messages.slice(0, 2));
  });

  it("rejects indexes that do not point to a user prompt", () => {
    expect(messagesThroughUserPrompt(messages, 1)).toBeNull();
    expect(messagesBeforeUserPrompt(messages, -1)).toBeNull();
    expect(messagesThroughUserPrompt(messages, messages.length)).toBeNull();
  });

  it("restores the exact conversation that existed before editing from a prompt", () => {
    const snapshot = createRevertSnapshot("session-1", messages, 2);
    expect(messagesBeforeUserPrompt(messages, 2)).toHaveLength(2);
    expect(messagesFromRevertSnapshot(snapshot, "session-1")).toEqual(messages);
  });

  it("does not restore a snapshot into a different conversation", () => {
    const snapshot = createRevertSnapshot("session-1", messages, 2);
    expect(messagesFromRevertSnapshot(snapshot, "session-2")).toBeNull();
  });
});
