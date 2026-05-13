import {
  GoogleGenAI,
  MediaResolution,
  Modality,
  StartSensitivity,
} from "@google/genai";
import { auth } from "@/auth";
import {
  getEmmaLiveSystemInstruction,
  getLiveModel,
  getPrebuiltVoiceName,
} from "@/lib/emma-live";
import type { GeminiLiveTokenResponse } from "@/lib/gemini-voice-session";

export const runtime = "nodejs";

function liveConnectConfig() {
  const voice = getPrebuiltVoiceName();
  return {
    /** Cookbook: `response_modalities=["AUDIO"]` — text replies come via transcription / streaming as applicable. */
    responseModalities: [Modality.AUDIO],
    mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
    systemInstruction: getEmmaLiveSystemInstruction(),
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      languageCode: "en-US",
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    realtimeInputConfig: {
      automaticActivityDetection: {
        prefixPaddingMs: 120,
        silenceDurationMs: 550,
        startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
      },
    },
    contextWindowCompression: {
      triggerTokens: "104857",
      slidingWindow: {
        targetTokens: "52428",
      },
    },
  };
}

export async function POST() {
  /** Dev: trial without login by default. Prod: only if GEMINI_FREE_TRIAL_NO_AUTH=true. */
  const allowAnon =
    process.env.GEMINI_FREE_TRIAL_NO_AUTH === "true" ||
    (process.env.NODE_ENV !== "production" &&
      process.env.GEMINI_REQUIRE_AUTH_FOR_LIVE !== "true") ||
    process.env.GEMINI_LIVE_TOKEN_ALLOW_ANON === "true";

  const session = await auth();
  if (!session?.user && !allowAnon) {
    return Response.json({ error: "Sign in required" }, { status: 401 });
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return Response.json(
      { error: "Server missing GEMINI_API_KEY" },
      { status: 503 },
    );
  }

  const model = getLiveModel();
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: "v1alpha" },
  });

  const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  try {
    const cfg = liveConnectConfig();
    const token = await ai.authTokens.create({
      config: {
        uses: 64,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          model,
          config: cfg,
        },
      },
    });

    const ephemeralKey =
      typeof token === "object" && token !== null && "name" in token
        ? String((token as { name?: string }).name)
        : undefined;

    if (!ephemeralKey) {
      return Response.json(
        { error: "Token response missing name field" },
        { status: 502 },
      );
    }

    const payload: GeminiLiveTokenResponse = {
      apiKey: ephemeralKey,
      model,
      httpOptions: { apiVersion: "v1alpha" },
      connectConfig: JSON.parse(JSON.stringify(cfg)) as Record<string, unknown>,
    };

    return Response.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Token creation failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
