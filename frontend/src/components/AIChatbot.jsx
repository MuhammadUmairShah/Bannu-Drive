import {
  Bot,
  MessageCircle,
  Send,
  User,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import api from "../utils/api";

const QUICK_ACTIONS = [
  "How does Bannu Drive work?",
  "How can I book a coach?",
  "How can I book a local ride?",
  "How can I send a parcel?",
];

const INITIAL_MESSAGE = {
  role: "assistant",
  content:
    "Assalam-o-Alaikum 👋 Main Bannu Drive AI Assistant hoon. Main aapko coach booking, rides, parcel delivery aur website ke baare mein help kar sakta hoon.",
};

export default function AIChatbot() {
  const [open, setOpen] = useState(false);

  const [messages, setMessages] = useState(() => {
    try {
      const saved = sessionStorage.getItem("bd-ai-chat");

      if (saved) {
        const parsed = JSON.parse(saved);

        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // Ignore invalid saved chat
    }

    return [INITIAL_MESSAGE];
  });

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        "bd-ai-chat",
        JSON.stringify(messages.slice(-20))
      );
    } catch {
      // Ignore storage errors
    }
  }, [messages]);

  useEffect(() => {
    if (!open) return;

    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });

    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 120);

    return () => clearTimeout(timer);
  }, [messages, open]);

  async function sendMessage(customMessage = null) {
    const text = (customMessage ?? input).trim();

    if (!text || sending) return;

    const userMessage = {
      role: "user",
      content: text,
    };

    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setInput("");
    setSending(true);

    try {
      const response = await api.post("/ai/chat", {
        messages: nextMessages.slice(-12).map((message) => ({
          role: message.role,
          content: message.content,
        })),
      });

      const reply = response.data?.message;

      if (!reply) {
        throw new Error("Empty AI response");
      }

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: reply,
        },
      ]);
    } catch (error) {
      console.error("AI chatbot error:", error);

      const serverMessage = error.response?.data?.message;

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            serverMessage ||
            "Sorry, abhi AI assistant available nahi hai. Please thori dair baad try karein.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    sendMessage();
  }

  function clearChat() {
    setMessages([INITIAL_MESSAGE]);

    try {
      sessionStorage.removeItem("bd-ai-chat");
    } catch {
      // Ignore
    }
  }

  return (
    <>
      {/* =========================================================
          FLOATING AI BUTTON
      ========================================================= */}
      {!open && (
        <div
          className="
            group
            fixed
            bottom-5
            right-5
            z-[100]
          "
        >
          {/* Soft outer glow */}
          <span
            className="
              pointer-events-none
              absolute
              -inset-2
              rounded-full
              bg-primary/20
              opacity-70
              blur-xl
              transition-all
              duration-500
              group-hover:bg-primary/30
              group-hover:opacity-100
            "
          />

          {/* Animated outer ring */}
          <span
            className="
              pointer-events-none
              absolute
              -inset-1
              rounded-full
              border
              border-primary/25
              opacity-80
              transition-all
              duration-500
              group-hover:-inset-2
              group-hover:border-primary/40
            "
          />

          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open Bannu Drive AI Assistant"
            className="
              relative
              flex
              h-[68px]
              w-[68px]
              items-center
              justify-center
              overflow-hidden
              rounded-full
              border
              border-white/20
              bg-primary
              text-white
              shadow-xl
              shadow-primary/30
              transition-all
              duration-300
              hover:-translate-y-1
              hover:scale-105
              hover:shadow-2xl
              hover:shadow-primary/40
              active:translate-y-0
              active:scale-95
            "
          >
            {/* Inner glass circle */}
            <span
              className="
                pointer-events-none
                absolute
                inset-[5px]
                rounded-full
                border
                border-white/15
                bg-white/[0.04]
              "
            />

            {/* Subtle top shine */}
            <span
              className="
                pointer-events-none
                absolute
                left-2
                right-2
                top-1
                h-1/2
                rounded-full
                bg-white/[0.06]
                blur-sm
              "
            />

            {/* AI Bot */}
            <Bot
              size={31}
              strokeWidth={1.9}
              className="
                relative
                z-10
                transition-all
                duration-300
                group-hover:scale-110
              "
            />

            {/* Small status dot */}
            <span
              className="
                absolute
                bottom-[10px]
                right-[10px]
                z-20
                h-3
                w-3
                rounded-full
                border-2
                border-primary
                bg-emerald-300
                shadow-sm
              "
            />
          </button>

          {/* Tooltip */}
          <div
            className="
              pointer-events-none
              absolute
              bottom-[78px]
              right-0
              translate-y-1
              whitespace-nowrap
              rounded-lg
              border
              border-line
              bg-surface
              px-3
              py-1.5
              text-[11px]
              font-medium
              text-fg
              opacity-0
              shadow-lg
              transition-all
              duration-200
              group-hover:translate-y-0
              group-hover:opacity-100
            "
          >
            Ask Bannu Drive AI
          </div>
        </div>
      )}

      {/* =========================================================
          CHAT WINDOW
      ========================================================= */}
      {open && (
        <div
          className="
            fixed
            bottom-4
            right-4
            z-[100]
            flex
            h-[min(570px,calc(100vh-32px))]
            w-[min(360px,calc(100vw-24px))]
            flex-col
            overflow-hidden
            rounded-[22px]
            border
            border-line
            bg-surface
            text-fg
            shadow-2xl
            shadow-black/20
          "
        >
          {/* =====================================================
              HEADER
          ===================================================== */}
          <div
            className="
              flex
              shrink-0
              items-center
              justify-between
              bg-primary
              px-3.5
              py-3
              text-white
            "
          >
            <div className="flex min-w-0 items-center gap-2.5">
              {/* Bot Icon */}
              <div
                className="
                  flex
                  h-9
                  w-9
                  shrink-0
                  items-center
                  justify-center
                  rounded-xl
                  bg-white/15
                "
              >
                <Bot size={20} />
              </div>

              {/* Title */}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2 className="truncate text-sm font-semibold">
                    Bannu Drive AI
                  </h2>

                  <span
                    className="
                      rounded-full
                      bg-white/15
                      px-1.5
                      py-0.5
                      text-[9px]
                      font-medium
                    "
                  >
                    AI
                  </span>
                </div>

                <p className="text-[10px] text-white/70">
                  Your travel assistant
                </p>
              </div>
            </div>

            {/* Header Actions */}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={clearChat}
                title="Clear chat"
                className="
                  rounded-lg
                  px-2
                  py-1.5
                  text-[10px]
                  font-medium
                  text-white/85
                  transition
                  hover:bg-white/10
                  hover:text-white
                "
              >
                Clear
              </button>

              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close chatbot"
                className="
                  rounded-lg
                  p-1.5
                  text-white/90
                  transition
                  hover:bg-white/10
                  hover:text-white
                "
              >
                <X size={17} />
              </button>
            </div>
          </div>

          {/* =====================================================
              MESSAGES
          ===================================================== */}
          <div
            className="
              min-h-0
              flex-1
              overflow-y-auto
              px-3
              py-3
              scrollbar-thin
            "
          >
            {messages.map((message, index) => {
              const isUser = message.role === "user";

              return (
                <div
                  key={`${message.role}-${index}`}
                  className={`mb-3 flex ${
                    isUser ? "justify-end" : "justify-start"
                  }`}
                >
                  {/* AI Icon */}
                  {!isUser && (
                    <div
                      className="
                        mr-1.5
                        mt-0.5
                        flex
                        h-7
                        w-7
                        shrink-0
                        items-center
                        justify-center
                        rounded-lg
                        bg-primary/10
                        text-primary
                      "
                    >
                      <Bot size={14} />
                    </div>
                  )}

                  {/* Message */}
                  <div
                    className={`
                      max-w-[84%]
                      rounded-[16px]
                      px-3
                      py-2.5
                      text-[13px]
                      leading-5
                      ${
                        isUser
                          ? "rounded-br-md bg-primary text-white"
                          : "rounded-bl-md border border-line bg-bg-soft"
                      }
                    `}
                  >
                    {message.content}
                  </div>

                  {/* User Icon */}
                  {isUser && (
                    <div
                      className="
                        ml-1.5
                        mt-0.5
                        flex
                        h-7
                        w-7
                        shrink-0
                        items-center
                        justify-center
                        rounded-lg
                        bg-primary/10
                        text-primary
                      "
                    >
                      <User size={14} />
                    </div>
                  )}
                </div>
              );
            })}

            {/* =================================================
                TYPING INDICATOR
            ================================================= */}
            {sending && (
              <div className="mb-3 flex items-start">
                <div
                  className="
                    mr-1.5
                    flex
                    h-7
                    w-7
                    items-center
                    justify-center
                    rounded-lg
                    bg-primary/10
                    text-primary
                  "
                >
                  <Bot size={14} />
                </div>

                <div
                  className="
                    rounded-[16px]
                    rounded-bl-md
                    border
                    border-line
                    bg-bg-soft
                    px-3.5
                    py-2.5
                  "
                >
                  <div className="flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* =====================================================
              QUICK ACTIONS
          ===================================================== */}
          {messages.length <= 1 && (
            <div className="shrink-0 border-t border-line px-3 py-2.5">
              <p className="mb-1.5 px-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                Quick help
              </p>

              <div className="grid grid-cols-2 gap-1.5">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action}
                    type="button"
                    disabled={sending}
                    onClick={() => sendMessage(action)}
                    className="
                      rounded-lg
                      border
                      border-line
                      bg-surface
                      px-2
                      py-1.5
                      text-left
                      text-[10px]
                      leading-4
                      text-fg
                      transition
                      hover:border-primary
                      hover:bg-primary/5
                      hover:text-primary
                      disabled:cursor-not-allowed
                      disabled:opacity-50
                    "
                  >
                    {action}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* =====================================================
              INPUT
          ===================================================== */}
          <form
            onSubmit={handleSubmit}
            className="shrink-0 border-t border-line p-2.5"
          >
            <div
              className="
                flex
                items-end
                gap-1.5
                rounded-xl
                border
                border-line
                bg-bg-soft
                p-1
                transition
                focus-within:border-primary
              "
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    handleSubmit(event);
                  }
                }}
                placeholder="Ask Bannu Drive AI..."
                rows={1}
                maxLength={4000}
                disabled={sending}
                className="
                  max-h-20
                  min-h-[38px]
                  flex-1
                  resize-none
                  bg-transparent
                  px-2.5
                  py-2
                  text-[12px]
                  text-fg
                  outline-none
                  placeholder:text-muted
                "
              />

              <button
                type="submit"
                disabled={!input.trim() || sending}
                aria-label="Send message"
                className="
                  flex
                  h-9
                  w-9
                  shrink-0
                  items-center
                  justify-center
                  rounded-lg
                  bg-primary
                  text-white
                  transition
                  hover:opacity-90
                  disabled:cursor-not-allowed
                  disabled:opacity-40
                "
              >
                <Send size={15} />
              </button>
            </div>

            <p className="mt-1.5 text-center text-[9px] text-muted">
              AI can make mistakes. Verify important booking information.
            </p>
          </form>
        </div>
      )}
    </>
  );
}