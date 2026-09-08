import { GoogleGenAI } from "@google/genai";
import type { PipelineMessage } from "@/lib/pipeline-types";
import { getTextModel } from "@/lib/pipeline-types";

export interface StreamTextOptions {
  systemInstruction: string;
  messages: PipelineMessage[];
  /** Extra context injected before recent turns (e.g. rolling summary). */
  contextPrefix?: string;
  /** Safety note when elevated crisis detected. */
  crisisNote?: string;
}

export interface StreamTextChunk {
  text: string;
  /** True on the first chunk that contains text (TTFT marker). */
  isFirst: boolean;
}

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error("Server missing GEMINI_API_KEY");
  return key;
}

function buildContents(
  messages: PipelineMessage[],
  contextPrefix?: string,
): { role: string; parts: { text: string }[] }[] {
  const contents: { role: string; parts: { text: string }[] }[] = [];

  if (contextPrefix?.trim()) {
    contents.push({
      role: "user",
      parts: [{ text: contextPrefix.trim() }],
    });
    contents.push({
      role: "model",
      parts: [{ text: "Understood. I'll keep that context in mind as we continue." }],
    });
  }

  for (const m of messages) {
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    });
  }

  return contents;
}

/** Stream assistant text from Gemini (text API — foundation for voice pipeline Phase 1). */
export async function* streamGeminiText(
  options: StreamTextOptions,
): AsyncGenerator<StreamTextChunk> {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const model = getTextModel();

  let systemInstruction = options.systemInstruction;
  if (options.crisisNote) {
    systemInstruction += `\n\nSafety note for this turn: ${options.crisisNote}`;
  }

  const stream = await ai.models.generateContentStream({
    model,
    contents: buildContents(options.messages, options.contextPrefix),
    config: { systemInstruction },
  });

  let first = true;
  for await (const chunk of stream) {
    const text = chunk.text ?? "";
    if (!text) continue;
    yield { text, isFirst: first };
    first = false;
  }
}

/** One-shot text generation (used for rolling summaries). */
export async function generateGeminiText(
  systemInstruction: string,
  userPrompt: string,
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: getApiKey() });
  const model = getTextModel();

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    config: { systemInstruction },
  });

  return (response.text ?? "").trim();
}
