/**
 * AudioWorklet: tap mono input, post Float32 chunks to main thread (no deprecated ScriptProcessor).
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (output.length > 0) {
      output[0].fill(0);
    }
    if (input.length > 0) {
      const ch = input[0];
      if (ch.length > 0) {
        const copy = new Float32Array(ch.length);
        copy.set(ch);
        this.port.postMessage(copy);
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
