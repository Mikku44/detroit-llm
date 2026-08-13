import { Message, MessageContent } from "../components/ui/message"
import { Bubble, BubbleContent } from "../components/ui/bubble"
import { MessageScrollerItem } from "../components/ui/message-scroller"
import { getMessageText } from "../lib/ai"
import type { UIMessage } from "ai"

type MessageAnimatedProps = {
  message: UIMessage
  scrollAnchor?: boolean
}

export function MessageAnimated({ message, scrollAnchor = false }: MessageAnimatedProps) {
  const text = getMessageText(message)
  const isUser = message.role === "user"

  return (
    <MessageScrollerItem scrollAnchor={scrollAnchor}>
      <Message align={isUser ? "end" : "start"}>
        {isUser ? null : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-medium text-zinc-400">
            AI
          </div>
        )}
        <MessageContent>
          <Bubble variant={isUser ? "default" : "muted"} align={isUser ? "end" : "start"}>
            <BubbleContent>
              <p className="whitespace-pre-wrap">{text}</p>
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  )
}
