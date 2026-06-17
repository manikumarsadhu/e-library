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

/**
 * Handles POST /api/ai/extract-outline
 * Accepts page text samples from the client and asks Gemini to identify chapter/section structure.
 * Body: { bookTitle: string, pageSamples: [{ pageNum: number, text: string }] }
 * Returns: { outline: [{ title: string, pageNum: number }] }
 */
export async function handleExtractOutlineRoute(req, res) {
  const body = await readJsonBody(req);
  const { bookTitle, pageSamples } = body || {};

  if (!pageSamples || !Array.isArray(pageSamples) || pageSamples.length === 0) {
    return res.status(400).json({ error: "pageSamples array is required" });
  }

  const samplesText = pageSamples
    .map((s) => `--- Page ${s.pageNum} ---\n${(s.text || "").slice(0, 600)}`)
    .join("\n\n");

  const prompt = `You are analyzing a book called "${bookTitle || "Unknown"}". Below are text samples from various pages.
Identify the main chapters and sections. For each chapter or major section, provide:
- The title (exactly as written in the book, or a clean version)
- The page number where it starts

Return ONLY valid JSON in this format, with no extra text:
[
  { "title": "Chapter 1: Introduction", "pageNum": 1 },
  { "title": "Chapter 2: The Journey", "pageNum": 15 }
]

Text samples:
${samplesText}`;

  try {
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { thinkingConfig: { thinkingBudget: 0 } },
    });

    const raw = response.text || "";
    // Extract JSON array from the response (strip markdown fences if any)
    const jsonMatch = raw.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!jsonMatch) {
      return res.status(200).json({ outline: [] });
    }

    let outline = JSON.parse(jsonMatch[0]);
    // Validate and clean
    outline = outline
      .filter((item) => item.title && typeof item.pageNum === "number" && item.pageNum >= 1)
      .sort((a, b) => a.pageNum - b.pageNum);

    return res.status(200).json({ outline });
  } catch (err) {
    console.error("AI outline extraction error:", err);
    return res.status(200).json({ outline: [] });
  }
}
