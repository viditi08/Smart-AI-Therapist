/** Text-to-speech — ElevenLabs streaming-quality MP3 for the spoken reply. */

const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

/** ElevenLabs stock voice ("Rachel") when no voice id is configured. */
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

function getApiKey(): string {
  const key =
    process.env.ELEVENLABS_API_KEY?.trim() || process.env.ELEVEN_LABS_API_KEY?.trim();
  if (!key) throw new Error("Server missing ELEVENLABS_API_KEY");
  return key;
}

function getVoiceId(): string {
  return process.env.ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE_ID;
}

function getModelId(): string {
  return process.env.ELEVENLABS_MODEL?.trim() || "eleven_flash_v2_5";
}

export async function synthesizeSpeech(text: string): Promise<{
  mimeType: string;
  base64: string;
}> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Nothing to speak");

  const url = new URL(`${ELEVENLABS_URL}/${getVoiceId()}`);
  url.searchParams.set("output_format", "mp3_22050_32");
  url.searchParams.set("optimize_streaming_latency", "4");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": getApiKey(),
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: trimmed,
      model_id: getModelId(),
    }),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`Text-to-speech failed (HTTP ${res.status}) ${detail}`);
  }

  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.byteLength === 0) throw new Error("Text-to-speech returned no audio");

  return { mimeType: "audio/mpeg", base64: audio.toString("base64") };
}
