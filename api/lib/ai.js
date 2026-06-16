import { GoogleGenAI } from "@google/genai";

let aiInstance = null;

/**
 * Retrieves the initialized Gemini API client instance.
 * Ensures the API key is present in environment variables.
 */
export function getAiClient() {
  if (aiInstance) return aiInstance;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured in the environment variables.");
  }

  aiInstance = new GoogleGenAI({ apiKey });
  return aiInstance;
}

import { readJsonBody } from "./body.js";

/**
 * Helper to stream completion chunks from Gemini 2.5 Flash.
 * @param {Object} options
 * @param {string|Array} options.contents Prompt contents
 * @param {string} [options.systemInstruction] Optional system guidelines for the prompt
 * @returns {AsyncGenerator<any>} Streaming response iterator
 */
export async function generateStream({ contents, systemInstruction }) {
  const ai = getAiClient();
  return ai.models.generateContentStream({
    model: "gemini-2.5-flash",
    contents,
    config: systemInstruction ? { systemInstruction } : undefined,
  });
}

/**
 * Handles /api/ai/chat requests, streaming Gemini response back to the client.
 */
export async function handleChatRoute(req, res) {
  const body = await readJsonBody(req);
  const { prompt, pageContext, pageNumber, bookTitle, history } = body;

  if (!prompt) {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  // Setup headers for SSE / Chunked Transfer streaming
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const ai = getAiClient();

    // Reconstruct conversation history for Gemini
    const contents = [];
    if (history && Array.isArray(history)) {
      for (const msg of history) {
        contents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.text }],
        });
      }
    }
    // Append current prompt
    contents.push({
      role: "user",
      parts: [{ text: prompt }],
    });

    const systemInstruction = `You are a helpful AI reading assistant for the book "${bookTitle || "Unknown"}".
The reader is looking at Page ${pageNumber || "Unknown"}.
Here is the text context of the current page to help you answer their questions:
"${pageContext || "No text context available."}"
Answer their questions concisely, using markdown when helpful. Reference details from the text context directly where applicable.`;

    const responseStream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents,
      config: {
        systemInstruction,
      },
    });

    for await (const chunk of responseStream) {
      if (chunk.text) {
        res.write(chunk.text);
      }
    }
  } catch (err) {
    console.error("Gemini stream error:", err);
    res.write("\n[ERROR: AI response failed]");
  } finally {
    res.end();
  }
}

