/** Streaming sentence detector — same idea as Mellow’s ElevenLabs TTS kickoff. */

const isSentencePunct = (c: string): boolean => c === "." || c === "!" || c === "?";

function isBoundaryAt(buffer: string, punctIdx: number, endOfStream: boolean): boolean {
  const next = buffer[punctIdx + 1];
  if (next === undefined) return endOfStream;
  return /\s/.test(next);
}

export function findFirstSentenceEnd(buffer: string, endOfStream: boolean): number {
  for (let i = 0; i < buffer.length; i++) {
    if (isSentencePunct(buffer[i]!) && isBoundaryAt(buffer, i, endOfStream)) {
      return i;
    }
  }
  return -1;
}

function consumeLeadingWhitespace(s: string): string {
  let i = 0;
  while (i < s.length && /\s/.test(s[i]!)) i++;
  return s.slice(i);
}

export type SentenceListener = (
  sentence: string,
  meta: { sentenceIndex: number; charCount: number },
) => void;

export type StreamingSentenceDetector = {
  push: (chunk: string) => void;
  flush: () => void;
};

export function createStreamingSentenceDetector(options?: {
  onSentence?: SentenceListener;
}): StreamingSentenceDetector {
  let buffer = "";
  let sentenceIndex = 0;

  const emitSentence = (sentence: string): void => {
    sentenceIndex += 1;
    options?.onSentence?.(sentence, {
      sentenceIndex,
      charCount: sentence.length,
    });
  };

  const extract = (endOfStream: boolean): void => {
    let end = findFirstSentenceEnd(buffer, endOfStream);
    while (end !== -1) {
      const sentence = buffer.slice(0, end + 1).trim();
      buffer = consumeLeadingWhitespace(buffer.slice(end + 1));
      if (sentence.length > 0) emitSentence(sentence);
      end = findFirstSentenceEnd(buffer, endOfStream);
    }
  };

  return {
    push(chunk: string) {
      if (!chunk) return;
      buffer += chunk;
      extract(false);
    },
    flush() {
      extract(true);
      const rest = buffer.trim();
      buffer = "";
      if (rest.length > 0) emitSentence(rest);
    },
  };
}
