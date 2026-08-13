import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

export function getMessageText(message: {
  content?: string;
  parts?: { type: string; text?: string }[];
}): string {
  if (message.parts) {
    const textPart = message.parts.find((p) => p.type === "text");
    if (textPart?.text) return textPart.text;
  }
  return message.content ?? "";
}

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts: { type: "text"; text: string }[];
};

const toUIMessage = (m: ChatMessage): UIMessage => ({
  id: m.id,
  role: m.role,
  parts: m.parts,
});

export function createChat() {
  const messages: ChatMessage[] = [];
  let counter = 0;

  function add(role: "user" | "assistant", content: string) {
    messages.push({
      id: String(++counter),
      role,
      content,
      parts: [{ type: "text", text: content }],
    });
    return api;
  }

  const api = {
    user: (content: string) => add("user", content),
    assistant: (content: string) => add("assistant", content),
    sleep: (_ms: number) => api,
    get: (index: number) => messages.slice(index).map(toUIMessage),
    transport: (opts: { delayMs: number }): ChatTransport<UIMessage> => ({
      async sendMessages({ messages: current }) {
        const reply = messages[current.length];
        const id = `assistant-${counter + 1}`;
        const text = reply?.content ?? "";
        return new ReadableStream<UIMessageChunk>({
          async start(controller) {
            controller.enqueue({ type: "text-start", id });
            if (text) {
              const chunks = text.match(/.{1,24}/gs) ?? [];
              for (const delta of chunks) {
                await new Promise((r) => setTimeout(r, opts.delayMs));
                controller.enqueue({ type: "text-delta", delta, id });
              }
            }
            controller.enqueue({ type: "text-end", id });
            controller.close();
          },
        });
      },
      async reconnectToStream() {
        return null;
      },
    }),
    next: (currentMessages: UIMessage[]) => {
      const idx = currentMessages.length;
      return idx < messages.length ? toUIMessage(messages[idx]) : undefined;
    },
  };

  return api;
}
