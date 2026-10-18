import type { Config } from '../config.js';
import { languageName } from '../languages.js';
import type { CallKind, CallState, EndReason, Peer } from '../protocol.js';
import type { Providers } from '../providers/types.js';
import type { Logger } from '../util/log.js';
import type { Leg, PhoneLeg } from './legs.js';
import { Route } from './route.js';

export interface SessionDeps {
  providers: Providers;
  config: Pick<Config, 'defaultVoiceId' | 'maxCallMinutes'>;
  log: Logger;
  /** Called exactly once when the session ends. */
  onEnded: (session: CallSession, reason: EndReason) => void;
}

/** One call: its legs, the translation routes between them, and its lifecycle. */
export class CallSession {
  state: CallState;
  startedAt: number | undefined;
  legs: Leg[] = [];
  routes: Route[] = [];
  /** Phone calls: Telnyx's id for hanging up. */
  callControlId: string | undefined;
  /** Before the callee picks up an app-to-app call, who we are ringing. */
  pendingPeer: Peer | undefined;
  /** App-to-app: username being rung. */
  calleeUsername: string | undefined;

  private limitTimer: ReturnType<typeof setTimeout> | undefined;
  private ringTimer: ReturnType<typeof setTimeout> | undefined;
  private endedReason: EndReason | undefined;

  constructor(
    readonly id: string,
    readonly kind: CallKind,
    initialState: CallState,
    private readonly deps: SessionDeps,
  ) {
    this.state = initialState;
  }

  get ended(): boolean {
    return this.state === 'ended';
  }

  addLeg(leg: Leg): void {
    this.legs.push(leg);
    leg.onClose((reason) => this.end(reason));
  }

  /** Both sides are present: start routing audio. */
  connect(): void {
    if (this.ended) return;
    if (this.ringTimer) clearTimeout(this.ringTimer);
    this.state = 'connected';
    this.startedAt = Date.now();
    this.routes = [];

    const routeDeps = {
      providers: this.deps.providers,
      config: this.deps.config,
      log: this.deps.log,
      callId: this.id,
      legs: () => this.legs,
    };
    const [a, b] = this.legs;
    if (a && b) {
      this.routes.push(new Route(a, b, routeDeps));
      // Mirror calls are one-way: the mirror leg never speaks.
      if (this.kind !== 'mirror') this.routes.push(new Route(b, a, routeDeps));
    }

    this.limitTimer = setTimeout(() => this.end('limit', 'Maximum call length reached.'), this.deps.config.maxCallMinutes * 60_000);
    this.limitTimer.unref?.();
    this.broadcast();
  }

  /** Ring timeout for app-to-app calls. */
  startRingTimer(ms: number): void {
    this.ringTimer = setTimeout(() => this.end('no_answer'), ms);
    this.ringTimer.unref?.();
  }

  /** Listener `leg` switches between translated / original audio. */
  setTranslate(leg: Leg, enabled: boolean): void {
    leg.listenTranslated = enabled;
    // Routes that deliver TO this leg re-evaluate (stop STT, flush audio, ...).
    for (const route of this.routes) if (route.dst === leg) route.refresh();
    this.broadcast();
  }

  /** Who `leg` is talking to, as shown on that leg's screen. */
  peerFor(leg: Leg): Peer {
    const other = this.legs.find((l) => l !== leg);
    if (other) return { label: other.label, language: other.language };
    return this.pendingPeer ?? { label: 'Unknown', language: leg.language };
  }

  broadcast(message?: string, reason?: EndReason, endedBy?: Leg): void {
    for (const leg of this.legs) {
      if (leg.kind !== 'app') continue;
      const peer = this.peerFor(leg);
      // "hangup" is from the point of view of whoever hung up; everybody else sees "remote_hangup".
      const shownReason = reason === 'hangup' && endedBy && endedBy !== leg ? 'remote_hangup' : reason;
      leg.notify({
        type: 'call.state',
        callId: this.id,
        kind: this.kind,
        state: this.state,
        peer,
        translate: leg.listenTranslated,
        translationActive: leg.listenTranslated && peer.language !== leg.language,
        ...(this.startedAt ? { startedAt: this.startedAt } : {}),
        ...(shownReason ? { reason: shownReason } : {}),
        ...(message ? { message } : {}),
      });
    }
  }

  /**
   * Tell the person on a phone line that this call is AI-translated, in their own language and in
   * a neutral voice. Played at the start of every phone call.
   */
  async announce(phone: PhoneLeg, speaker: { name: string; language: string }): Promise<void> {
    const english =
      `Hello! This call is being translated by an A.I. interpreter. ` +
      `You are speaking with ${speaker.name}, who speaks ${languageName(speaker.language)}. ` +
      `You will hear a computer-generated version of their voice speaking your language. ` +
      `Please speak naturally, and pause briefly after each sentence.`;
    let text = english;
    try {
      if (phone.language !== 'en') {
        text = (await this.deps.providers.translator.translate({ text: english, from: 'en', to: phone.language, context: [] })) || english;
      }
    } catch (err) {
      this.deps.log.warn('could not translate the AI notice; playing it in English', err);
    }
    phone.echo.remember(text);
    for (const leg of this.legs) {
      if (leg.kind === 'app') leg.notify({ type: 'notice', callId: this.id, text: 'The other person was told this call is AI-translated.' });
    }
    phone.outQueue.enqueue(async (signal) => {
      try {
        for await (const chunk of this.deps.providers.tts.synthesize({
          text,
          voiceId: this.deps.config.defaultVoiceId,
          language: phone.language,
          format: phone.format,
          signal,
        })) {
          if (signal.aborted) return;
          phone.sendAudio(chunk);
        }
      } catch (err) {
        if (!signal.aborted) this.deps.log.error('could not play the AI notice', err);
      }
    });
  }

  end(reason: EndReason, message?: string, endedBy?: Leg): void {
    if (this.ended) return;
    this.state = 'ended';
    this.endedReason = reason;
    if (this.limitTimer) clearTimeout(this.limitTimer);
    if (this.ringTimer) clearTimeout(this.ringTimer);
    for (const route of this.routes) route.dispose();
    this.routes = [];
    this.broadcast(message, reason, endedBy);
    for (const leg of this.legs) leg.close();
    this.deps.onEnded(this, reason);
  }

  get reason(): EndReason | undefined {
    return this.endedReason;
  }
}
