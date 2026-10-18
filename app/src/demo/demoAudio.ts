// TEMPORARY stand-in for react-native-audio-api in demo mode (see demo.ts).
// The recorder emits a synthetic, speech-like signal so level meters and voice
// recording move; the player and audio session do nothing.
class DemoRecorder {
  private timer: ReturnType<typeof setInterval> | null = null;
  private cb: ((e: any) => void) | null = null;
  private n = 0;

  onAudioReady(_opts: unknown, cb: (e: any) => void) { this.cb = cb; }
  clearOnAudioReady() { this.cb = null; }
  start() {
    this.timer = setInterval(() => {
      const amp = 0.25 * Math.abs(Math.sin(this.n++ / 4));
      const data = new Float32Array(1600);
      for (let i = 0; i < data.length; i++) data[i] = amp * Math.sin(i / 6);
      this.cb?.({ buffer: { sampleRate: 16000, getChannelData: () => data } });
    }, 100);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}

const source = { connect() {}, start() {}, stop() {}, enqueueBuffer() {}, clearBuffers() {} };

class DemoContext {
  destination = {};
  createBufferQueueSource() { return source; }
  createBuffer() { return { copyToChannel() {} }; }
  close() { return Promise.resolve(); }
}

const DemoManager = {
  setAudioSessionOptions() {},
  setAudioSessionActivity: async () => true,
  checkRecordingPermissions: async () => 'Granted',
  requestRecordingPermissions: async () => 'Granted',
};

export const demoAudioApi = { AudioRecorder: DemoRecorder, AudioContext: DemoContext, AudioManager: DemoManager };
