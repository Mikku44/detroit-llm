import {
  type ChatModelAdapter,
  type ThreadMessage,
} from "@assistant-ui/react";

const getMessageText = (message: ThreadMessage): string => {
  const parts = "content" in message ? (message.content as readonly unknown[]) : [];
  return (parts as { type: string; text?: string }[])
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
};

export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("session_token");
}

export function createApiAdapter(): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const token = typeof window !== "undefined" ? localStorage.getItem("session_token") : null;
      if (!token) {
        yield {
          content: [
            {
              type: "text",
              text: "[Error] Not signed in. Refresh the page and log in again.",
            },
          ],
        };
        return;
      }

      const payload = {
        model: "google/gemma-4-26B-A4B",
        messages: messages.map((m) => ({
          role: m.role,
          content: getMessageText(m),
        })),
        temperature: 0.7,
        max_tokens: 4096,
      };

      let response: Response;
      try {
        response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
          signal: abortSignal,
        });
      } catch (e) {
        if (abortSignal.aborted || (e instanceof Error && e.name === "AbortError")) {
          return;
        }
        yield {
          content: [
            {
              type: "text",
              text: `[Error] ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
        };
        return;
      }

      if (!response.ok || !response.body) {
        const detail = await response
          .text()
          .catch(() => `HTTP ${response.status}`);
        yield {
          content: [{ type: "text", text: `[Error] ${detail}` }],
        };
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          accumulatedText += chunk;

          // ✅ แก้ไขจุดนี้: ต้องส่ง { type: "text", text: accumulatedText }
          yield {
            content: [{ type: "text", text: accumulatedText }],
          };
        }

        const tail = decoder.decode();
        if (tail) {
          accumulatedText += tail;
          yield {
            content: [{ type: "text", text: accumulatedText }],
          };
        }
      } catch (e) {
        if (!abortSignal.aborted) {
          yield {
            content: [
              {
                type: "text",
                text: `[Error] ${e instanceof Error ? e.message : String(e)}`,
              },
            ],
          };
        }
      }
    },
  };
}