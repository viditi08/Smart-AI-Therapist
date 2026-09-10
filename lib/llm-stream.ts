import type { PipelineMessage } from "@/lib/pipeline-types";
import { FALLBACK_TEXT_MODELS, getTextModel } from "@/lib/pipeline-types";

/**
 * Therapist LLM — NVIDIA NIM through its OpenAI-compatible chat completions API.
 * Point `LLM_BASE_URL` / `LLM_API_KEY` at any other OpenAI-compatible provider to swap it out.
 */

export interface StreamTextOptions {
  systemInstruction: string;
  messages: PipelineMessage[];
  contextPrefix?: string;
  crisisNote?: string;
  maxTokens?: number;
}

export interface StreamTextChunk {
  text: string;
  isFirst: boolean;
}

const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";

function getBaseUrl(): string {
  const raw = process.env.LLM_BASE_URL?.trim() || DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, "");
}

function getApiKey(): string {
  const key =
    process.env.NVIDIA_API_KEY?.trim() ||
    process.env.LLM_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("Server missing NVIDIA_API_KEY");
  return key;
}

/**
 * NVIDIA retires models permanently (410 Gone) and gates others per account (404).
 * Remember those so a retired model costs one wasted request per process, not one per turn.
 */
const retiredModels = new Set<string>();

function modelsToTry(): string[] {
  const all = [...new Set([getTextModel(), ...FALLBACK_TEXT_MODELS].filter(Boolean))];
  const live = all.filter((m) => !retiredModels.has(m));
  return live.length > 0 ? live : all;
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function buildMessages(options: StreamTextOptions): ChatMessage[] {
  let system = options.systemInstruction;
  if (options.crisisNote) {
    system += `\n\nSafety note for this turn: ${options.crisisNote}`;
  }

  const out: ChatMessage[] = [{ role: "system", content: system }];

  if (options.contextPrefix?.trim()) {
    out.push({ role: "system", content: options.contextPrefix.trim() });
  }

  for (const m of options.messages) {
    out.push({ role: m.role, content: m.content });
  }

  return out;
}

/** Longest suffix of `text` that could be the start of `tag`. */
function partialTagTail(text: string, tag: string): string {
  const max = Math.min(tag.length - 1, text.length);
  for (let n = max; n > 0; n--) {
    if (tag.startsWith(text.slice(text.length - n))) return text.slice(text.length - n);
  }
  return "";
}

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

/**
 * Some open models leak chain-of-thought as `<think>…</think>`. Spoken replies must
 * never include it, so strip those spans even when they straddle stream chunks.
 */
function createThinkStripper() {
  let inThink = false;
  let pending = "";

  return {
    push(chunk: string): string {
      let text = pending + chunk;
      pending = "";
      let out = "";

      while (text.length > 0) {
        if (inThink) {
          const end = text.indexOf(THINK_CLOSE);
          if (end === -1) {
            pending = partialTagTail(text, THINK_CLOSE);
            text = "";
          } else {
            text = text.slice(end + THINK_CLOSE.length);
            inThink = false;
          }
          continue;
        }

        const start = text.indexOf(THINK_OPEN);
        if (start === -1) {
          const tail = partialTagTail(text, THINK_OPEN);
          out += text.slice(0, text.length - tail.length);
          pending = tail;
          text = "";
        } else {
          out += text.slice(0, start);
          text = text.slice(start + THINK_OPEN.length);
          inThink = true;
        }
      }

      return out;
    },
    flush(): string {
      const rest = inThink ? "" : pending;
      pending = "";
      return rest;
    },
  };
}

/** NIM returns these while a model's workers are saturated; the same request usually succeeds shortly after. */
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

class LlmHttpError extends Error {
  constructor(
    readonly status: number,
    readonly model: string,
    detail: string,
  ) {
    super(`LLM request failed for ${model} (HTTP ${status}) ${detail}`);
    this.name = "LlmHttpError";
  }

  get transient(): boolean {
    return TRANSIENT_STATUS.has(this.status);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function chatCompletion(
  model: string,
  messages: ChatMessage[],
  stream: boolean,
  maxTokens = 400,
): Promise<Response> {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream,
    temperature: 0.7,
    max_tokens: maxTokens,
    stop: [THINK_OPEN, `\n${THINK_OPEN}`],
  };

  // Reasoning models spend the whole token budget thinking and can return empty
  // content. Therapy replies do not need it, and skipping it roughly halves latency.
  if (/reasoning/i.test(model)) {
    body.chat_template_kwargs = { thinking: false };
  }

  const res = await fetch(`${getBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      Accept: stream ? "text/event-stream" : "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 400);
    if (res.status === 404 || res.status === 410) {
      retiredModels.add(model);
      console.warn(`[llm] skipping ${model} for this process: HTTP ${res.status}`);
    }
    throw new LlmHttpError(res.status, model, detail);
  }

  return res;
}

async function chatCompletionWithRetry(
  model: string,
  messages: ChatMessage[],
  stream: boolean,
  maxTokens = 400,
): Promise<Response> {
  try {
    return await chatCompletion(model, messages, stream, maxTokens);
  } catch (e) {
    const retryable = e instanceof LlmHttpError && e.transient;
    if (!retryable) throw e;
    await sleep(120);
    return await chatCompletion(model, messages, stream, maxTokens);
  }
}

async function* streamWithModel(
  model: string,
  options: StreamTextOptions,
): AsyncGenerator<StreamTextChunk> {
  const res = await chatCompletionWithRetry(
    model,
    buildMessages(options),
    true,
    options.maxTokens ?? 400,
  );
  if (!res.body) throw new Error("LLM returned no stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const stripper = createThinkStripper();
  let buffer = "";
  let first = true;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let delta = "";
      try {
        const parsed = JSON.parse(payload) as {
          choices?: { delta?: { content?: string } }[];
        };
        delta = parsed.choices?.[0]?.delta?.content ?? "";
      } catch {
        continue;
      }

      const text = stripper.push(delta);
      if (!text) continue;
      yield { text, isFirst: first };
      first = false;
    }
  }

  const tail = stripper.flush();
  if (tail) yield { text: tail, isFirst: first };
}

/** Stream assistant text, falling back to the next configured model on failure. */
export async function* streamAssistantText(
  options: StreamTextOptions,
): AsyncGenerator<StreamTextChunk> {
  const models = modelsToTry();
  // Report the configured model's failure, not the fallback's — that is the actionable one.
  let firstError: Error | null = null;

  for (let i = 0; i < models.length; i++) {
    const model = models[i]!;
    try {
      let yielded = false;
      for await (const chunk of streamWithModel(model, options)) {
        yielded = true;
        yield chunk;
      }
      if (yielded || i === models.length - 1) return;
    } catch (e) {
      firstError ??= e instanceof Error ? e : new Error(String(e));
      if (i === models.length - 1) break;
    }
  }

  throw firstError ?? new Error("LLM generation failed");
}

/** One-shot completion — used for rolling and post-session summaries. */
export async function generateAssistantText(
  systemInstruction: string,
  userPrompt: string,
): Promise<string> {
  let firstError: Error | null = null;

  for (const model of modelsToTry()) {
    try {
      const res = await chatCompletionWithRetry(
        model,
        [
          { role: "system", content: systemInstruction },
          { role: "user", content: userPrompt },
        ],
        false,
      );
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const raw = data.choices?.[0]?.message?.content ?? "";
      const stripper = createThinkStripper();
      const text = `${stripper.push(raw)}${stripper.flush()}`.trim();
      if (text) return text;
    } catch (e) {
      firstError ??= e instanceof Error ? e : new Error(String(e));
    }
  }

  throw firstError ?? new Error("Summary generation failed");
}
