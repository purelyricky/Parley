import type { WebSocket } from 'ws';
import { z } from 'zod';
import { toWsUrl, type Config } from '../config.js';
import { isSupportedLanguage } from '../languages.js';
import type { ClientMessage, EndReason } from '../protocol.js';
import { ProviderError, type Providers } from '../providers/types.js';
import type { UserStore } from '../users.js';
import type { Logger } from '../util/log.js';
import { isE164, maskPhone, newId, normalizePhone } from '../util/misc.js';
import { AppLeg, MirrorLeg, PhoneLeg, type AppConnection } from './legs.js';
import { CallSession } from './session.js';

export interface ManagerDeps {
  config: Config;
  providers: Providers;
  users: UserStore;
  log: Logger;
  /** Test hook: how phone legs are created (e.g. unpaced). */
  phoneLegOptions?: ConstructorParameters<typeof PhoneLeg>[2];
}

const RING_TIMEOUT_MS = 45_000;
const DIAL_TIMEOUT_SECS = 40;

const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('call.phone'), to: z.string().max(40), theirLanguage: z.string().max(8), translate: z.boolean().optional() }),
  z.object({ type: z.literal('call.user'), to: z.string().max(40), translate: z.boolean().optional() }),
  z.object({ type: z.literal('call.mirror'), targetLanguage: z.string().max(8) }),
  z.object({ type: z.literal('call.accept'), callId: z.string().max(64) }),
  z.object({ type: z.literal('call.decline'), callId: z.string().max(64) }),
  z.object({ type: z.literal('call.hangup'), callId: z.string().max(64) }),
  z.object({ type: z.literal('call.translate'), callId: z.string().max(64), enabled: z.boolean() }),
]);

export class CallManager {
  private sessions = new Map<string, CallSession>();
  private connections = new Map<string, AppConnection>();
  private phoneHistory = new Map<string, number[]>();

  constructor(private readonly deps: ManagerDeps) {}

  get activeCalls(): number {
    return this.sessions.size;
  }

  get phoneEnabled(): boolean {
    return Boolean(this.deps.providers.telephony && this.deps.config.telnyx && this.deps.config.publicUrl);
  }

  isOnline(username: string): boolean {
    return this.connections.has(username);
  }

  // ---- connections -------------------------------------------------------------------------

  addConnection(conn: AppConnection): void {
    const previous = this.connections.get(conn.username);
    if (previous && previous !== conn) this.endCallOf(previous, 'hangup'); // e.g. app restarted
    this.connections.set(conn.username, conn);
  }

  removeConnection(conn: AppConnection): void {
    if (this.connections.get(conn.username) === conn) this.connections.delete(conn.username);
    this.endCallOf(conn, 'hangup');
  }

  private endCallOf(conn: AppConnection, reason: EndReason): void {
    if (!conn.callId) return;
    this.sessions.get(conn.callId)?.end(reason, undefined, conn.leg);
  }

  // ---- messages from the app ---------------------------------------------------------------

  handleMessage(conn: AppConnection, raw: unknown): void {
    const parsed = messageSchema.safeParse(raw);
    if (!parsed.success) {
      conn.send({ type: 'error', code: 'bad_message', message: 'Unrecognized message.' });
      return;
    }
    const msg: ClientMessage = parsed.data;
    switch (msg.type) {
      case 'ping':
        conn.send({ type: 'pong' });
        break;
      case 'call.phone':
        void this.startPhoneCall(conn, msg.to, msg.theirLanguage, msg.translate ?? true);
        break;
      case 'call.user':
        this.startUserCall(conn, msg.to, msg.translate ?? true);
        break;
      case 'call.mirror':
        this.startMirrorCall(conn, msg.targetLanguage);
        break;
      case 'call.accept':
        this.acceptCall(conn, msg.callId);
        break;
      case 'call.decline':
        this.declineCall(conn, msg.callId);
        break;
      case 'call.hangup':
        this.sessionOf(conn, msg.callId)?.end('hangup', undefined, conn.leg);
        break;
      case 'call.translate': {
        const session = this.sessionOf(conn, msg.callId);
        const leg = session?.legs.find((l) => l instanceof AppLeg && l.conn === conn);
        if (session && leg) session.setTranslate(leg, msg.enabled);
        break;
      }
    }
  }

  /** A session the connection is actually part of (never trust a client-supplied id blindly). */
  private sessionOf(conn: AppConnection, callId: string): CallSession | undefined {
    if (conn.callId !== callId) return undefined;
    return this.sessions.get(callId);
  }

  private refuse(conn: AppConnection, code: string, message: string): void {
    conn.send({ type: 'error', code, message });
  }

  private canStartCall(conn: AppConnection): boolean {
    if (conn.callId) {
      this.refuse(conn, 'busy', 'You are already in a call.');
      return false;
    }
    if (this.sessions.size >= this.deps.config.maxConcurrentCalls) {
      this.refuse(conn, 'too_many_calls', 'The server is busy right now. Try again in a minute.');
      return false;
    }
    return true;
  }

  private newSession(kind: 'phone' | 'user' | 'mirror', state: 'dialing' | 'ringing' | 'connected', id = newId()): CallSession {
    const session = new CallSession(id, kind, state, {
      providers: this.deps.providers,
      config: this.deps.config,
      log: this.deps.log.child(`call:${id.slice(0, 6)}`),
      onEnded: (s, reason) => this.onSessionEnded(s, reason),
    });
    this.sessions.set(id, session);
    return session;
  }

  /** A leg is labelled with its own name: that is what the *other* side sees as its peer. */
  private appLegFor(conn: AppConnection): AppLeg | undefined {
    const user = this.deps.users.byUsername(conn.username);
    if (!user) return undefined;
    const leg = new AppLeg(conn, user.language, user.voiceId, `@${user.username}`);
    conn.leg = leg;
    return leg;
  }

  // ---- phone calls -------------------------------------------------------------------------

  private async startPhoneCall(conn: AppConnection, rawTo: string, theirLanguage: string, translate: boolean): Promise<void> {
    const { config, providers, log } = this.deps;
    const telephony = providers.telephony;
    if (!telephony || !config.telnyx || !config.publicUrl) {
      return this.refuse(conn, 'phone_disabled', 'Phone calls are not set up on this server yet. App-to-app calls still work.');
    }
    const to = normalizePhone(rawTo);
    if (!isE164(to)) return this.refuse(conn, 'bad_number', 'Enter the full number with country code, e.g. +36 30 123 4567.');
    if (!isSupportedLanguage(theirLanguage)) return this.refuse(conn, 'unsupported_language', 'That language is not supported.');
    if (config.allowedDialPrefixes.length > 0 && !config.allowedDialPrefixes.some((p) => to.startsWith(p))) {
      return this.refuse(conn, 'dest_not_allowed', 'Calls to that country are not enabled on this server.');
    }
    if (!this.canStartCall(conn)) return;
    if (!this.takePhoneCallSlot(conn.username)) {
      return this.refuse(conn, 'rate_limited', 'Too many phone calls this hour. Try again later.');
    }

    const session = this.newSession('phone', 'dialing');
    const me = this.appLegFor(conn);
    if (!me) {
      session.end('error');
      return;
    }
    me.listenTranslated = translate;
    const phone = new PhoneLeg(theirLanguage, to, {
      paced: config.paceToPhone,
      ...this.deps.phoneLegOptions,
      log: log.child('phone'),
    });
    phone.listenTranslated = translate;
    session.addLeg(me);
    session.addLeg(phone);
    conn.callId = session.id;
    session.broadcast();

    phone.onStreamStart(() => {
      if (session.ended) return;
      log.info(`phone call ${session.id.slice(0, 6)} answered (${maskPhone(to)})`);
      session.connect();
      const user = this.deps.users.byUsername(conn.username);
      void session.announce(phone, { name: user?.username ?? 'your caller', language: me.language });
    });

    try {
      const { callControlId } = await telephony.dial({
        to,
        from: config.telnyx.fromNumber,
        connectionId: config.telnyx.connectionId,
        streamUrl: `${toWsUrl(config.publicUrl)}/telnyx/stream/${session.id}`,
        webhookUrl: `${config.publicUrl}/telnyx/webhook`,
        clientState: session.id,
        timeoutSecs: DIAL_TIMEOUT_SECS,
      });
      session.callControlId = callControlId;
      if (session.ended) void telephony.hangup(callControlId).catch(() => undefined); // user hung up while dialing
    } catch (err) {
      log.error('dial failed', err);
      const message = err instanceof ProviderError && err.userMessage ? err.userMessage : 'Could not place the call.';
      session.end('failed', message);
    }
  }

  private takePhoneCallSlot(username: string): boolean {
    const now = Date.now();
    const recent = (this.phoneHistory.get(username) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= this.deps.config.phoneCallsPerHour) return false;
    recent.push(now);
    this.phoneHistory.set(username, recent);
    return true;
  }

  /** Telnyx opened its media WebSocket for this call. */
  attachTelnyxStream(callId: string, ws: WebSocket): boolean {
    const session = this.sessions.get(callId);
    const phone = session?.legs.find((l): l is PhoneLeg => l instanceof PhoneLeg);
    if (!session || !phone || session.ended) return false;
    phone.attachStream(ws);
    return true;
  }

  /** Telnyx call-status webhook (call.answered, call.hangup, ...). */
  handleTelnyxWebhook(body: unknown): void {
    const data = (body as { data?: { event_type?: string; payload?: Record<string, unknown> } } | null)?.data;
    const eventType = data?.event_type;
    const payload = data?.payload ?? {};
    let callId: string | undefined;
    const clientState = payload.client_state;
    if (typeof clientState === 'string') callId = Buffer.from(clientState, 'base64').toString('utf8');
    const session = callId ? this.sessions.get(callId) : undefined;
    this.deps.log.debug(`telnyx webhook: ${eventType} (${session ? 'known' : 'unknown'} call)`);
    if (!session) return;

    if (eventType === 'call.hangup') {
      const cause = String(payload.hangup_cause ?? '');
      session.end(session.state === 'connected' ? 'remote_hangup' : mapHangupCause(cause), hangupMessage(cause, session.state));
    }
  }

  // ---- app-to-app calls --------------------------------------------------------------------

  private startUserCall(conn: AppConnection, rawTo: string, translate: boolean): void {
    if (!this.canStartCall(conn)) return;
    const callee = this.deps.users.byUsername(rawTo);
    const caller = this.deps.users.byUsername(conn.username);
    if (!callee || !caller) return this.refuse(conn, 'no_such_user', 'There is no user with that username.');
    if (callee.username === caller.username) return this.refuse(conn, 'self_call', 'You cannot call yourself. Try the mirror test!');
    const calleeConn = this.connections.get(callee.username);
    if (!calleeConn) return this.refuse(conn, 'offline', `@${callee.username} is not online right now.`);
    if (calleeConn.callId) return this.refuse(conn, 'busy', `@${callee.username} is on another call.`);

    const session = this.newSession('user', 'ringing');
    const me = this.appLegFor(conn);
    if (!me) return session.end('error');
    me.listenTranslated = translate;
    session.addLeg(me);
    session.calleeUsername = callee.username;
    session.pendingPeer = { label: `@${callee.username}`, language: callee.language };
    conn.callId = session.id;
    session.startRingTimer(RING_TIMEOUT_MS);
    session.broadcast();
    calleeConn.send({ type: 'call.incoming', callId: session.id, from: { username: caller.username, language: caller.language } });
  }

  private acceptCall(conn: AppConnection, callId: string): void {
    const session = this.sessions.get(callId);
    if (!session || session.ended || session.calleeUsername !== conn.username || conn.callId) {
      return this.refuse(conn, 'no_such_call', 'That call is no longer available.');
    }
    const you = this.appLegFor(conn);
    if (!you) return;
    conn.callId = session.id;
    session.addLeg(you);
    session.connect();
  }

  private declineCall(conn: AppConnection, callId: string): void {
    const session = this.sessions.get(callId);
    if (session && !session.ended && session.calleeUsername === conn.username && session.state === 'ringing') {
      session.end('declined');
    }
  }

  // ---- mirror (self-test) ------------------------------------------------------------------

  private startMirrorCall(conn: AppConnection, targetLanguage: string): void {
    if (!isSupportedLanguage(targetLanguage)) return this.refuse(conn, 'unsupported_language', 'That language is not supported.');
    if (!this.canStartCall(conn)) return;
    const session = this.newSession('mirror', 'connected');
    const me = this.appLegFor(conn);
    if (!me) return session.end('error');
    session.addLeg(me);
    session.addLeg(new MirrorLeg(targetLanguage, me));
    conn.callId = session.id;
    session.connect();
  }

  // ---- lifecycle ---------------------------------------------------------------------------

  private onSessionEnded(session: CallSession, reason: EndReason): void {
    this.sessions.delete(session.id);
    for (const leg of session.legs) {
      if (leg instanceof AppLeg && leg.conn.callId === session.id) leg.conn.callId = undefined;
    }
    // An app-to-app call that never got picked up still has a callee screen ringing.
    if (session.calleeUsername && session.legs.length < 2) {
      this.connections.get(session.calleeUsername)?.send({
        type: 'call.state',
        callId: session.id,
        kind: 'user',
        state: 'ended',
        peer: session.pendingPeer ?? { label: '', language: 'en' },
        translate: true,
        translationActive: false,
        reason,
      });
    }
    const { telephony } = this.deps.providers;
    if (telephony && session.callControlId && reason !== 'remote_hangup') {
      void telephony.hangup(session.callControlId).catch((err) => this.deps.log.warn('hangup failed', err));
    }
    this.deps.log.info(`call ${session.id.slice(0, 6)} (${session.kind}) ended: ${reason}`);
  }

  /** Graceful shutdown. */
  endAll(): void {
    for (const s of [...this.sessions.values()]) s.end('hangup');
  }
}

export function mapHangupCause(cause: string): EndReason {
  switch (cause) {
    case 'user_busy':
      return 'busy';
    case 'no_answer':
    case 'timeout':
    case 'originator_cancel':
      return 'no_answer';
    case 'call_rejected':
      return 'declined';
    default:
      return 'failed';
  }
}

function hangupMessage(cause: string, state: string): string | undefined {
  if (state === 'connected') return undefined;
  switch (cause) {
    case 'user_busy':
      return 'The line is busy.';
    case 'no_answer':
    case 'timeout':
      return 'No answer.';
    case 'call_rejected':
      return 'The call was declined.';
    case 'unallocated_number':
    case 'invalid_number_format':
      return 'That number does not seem to exist.';
    default:
      return cause ? `The call could not be completed (${cause.replace(/_/g, ' ')}).` : undefined;
  }
}
