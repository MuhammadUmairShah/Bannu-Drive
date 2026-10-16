import { generateAIReply } from "./ai.service.js";

export async function chatWithAI(req, res) {
  try {
    const messages = Array.isArray(req.body?.messages)
      ? req.body.messages
      : [];

    if (!messages.length) {
      return res.status(400).json({
        success: false,
        message: "Please provide a message.",
      });
    }

    const lastMessage = messages[messages.length - 1];

    if (
      !lastMessage ||
      lastMessage.role !== "user" ||
      typeof lastMessage.content !== "string" ||
      !lastMessage.content.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid user message.",
      });
    }

    if (lastMessage.content.trim().length > 4000) {
      return res.status(400).json({
        success: false,
        message: "Message is too long.",
      });
    }

    const reply = await generateAIReply(messages);

    return res.status(200).json({
      success: true,
      message: reply,
    });
  } catch (error) {
    console.error("AI chatbot error:", error);

    if (error?.status === 401) {
      return res.status(500).json({
        success: false,
        message: "AI service configuration error.",
      });
    }

    if (error?.status === 429) {
      return res.status(429).json({
        success: false,
        message: "AI is currently busy. Please try again in a moment.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "AI assistant is temporarily unavailable.",
    });
  }
}