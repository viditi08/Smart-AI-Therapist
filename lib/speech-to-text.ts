/** Speech-to-text — Deepgram prerecorded transcription. */

const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";

function getApiKey(): string {
  const key = process.env.DEEPGRAM_API_KEY?.trim();
  if (!key) throw new Error("Server missing DEEPGRAM_API_KEY");
  return key;
}

function getModel(): string {
  return process.env.DEEPGRAM_MODEL?.trim() || "nova-3";
}

export async function transcribeAudio(input: {
  mimeType: string;
  base64: string;
}): Promise<string> {
  const audio = Buffer.from(input.base64, "base64");
  if (audio.byteLength === 0) return "";

  const url = new URL(DEEPGRAM_URL);
  url.searchParams.set("model", getModel());
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("punctuate", "true");
  url.searchParams.set("language", process.env.DEEPGRAM_LANGUAGE?.trim() || "en");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${getApiKey()}`,
      "Content-Type": input.mimeType || "audio/webm",
    },
    body: new Uint8Array(audio),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`Speech-to-text failed (HTTP ${res.status}) ${detail}`);
  }

  const data = (await res.json()) as {
    results?: {
      channels?: { alternatives?: { transcript?: string }[] }[];
    };
  };

  return (data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim();
}
