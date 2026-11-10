export function voiceBackendUrl(): string {
  const configured = (process.env.PIPECAT_BACKEND_URL || "")
    .trim()
    .replace(/^[=]+/, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\/$/, "");
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    return "https://smart-ai-therapist.onrender.com";
  }
  return "http://127.0.0.1:7860";
}

export function isLocalVoiceBackend(url: string): boolean {
  return url.includes("127.0.0.1") || url.includes("localhost");
}
