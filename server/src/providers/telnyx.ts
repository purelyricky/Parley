import { readErrorBody } from './elevenlabsTts.js';
import { ProviderError, type DialOptions, type Telephony } from './types.js';

export interface TelnyxConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Outbound calling through Telnyx Call Control.
 * We ask Telnyx to fork the call audio to our WebSocket (`stream_url`) and to accept audio back
 * in the same call (`stream_bidirectional_mode: rtp`, PCMU = plain 8 kHz mu-law, i.e. no transcoding).
 */
export function createTelnyxTelephony(cfg: TelnyxConfig): Telephony {
  const base = cfg.baseUrl ?? 'https://api.telnyx.com';
  const doFetch = cfg.fetchImpl ?? fetch;
  const headers = { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' };

  return {
    async dial(opts: DialOptions) {
      const res = await doFetch(`${base}/v2/calls`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          connection_id: opts.connectionId,
          to: opts.to,
          from: opts.from,
          webhook_url: opts.webhookUrl,
          stream_url: opts.streamUrl,
          stream_track: 'inbound_track',
          stream_bidirectional_mode: 'rtp',
          stream_bidirectional_codec: 'PCMU',
          client_state: Buffer.from(opts.clientState).toString('base64'),
          timeout_secs: opts.timeoutSecs,
          answering_machine_detection: 'disabled',
        }),
      });
      if (!res.ok) {
        const detail = await readErrorBody(res);
        throw new ProviderError(`Telnyx dial ${res.status}: ${detail}`, res.status, friendlyDialError(res.status, detail));
      }
      const json = (await res.json()) as { data?: { call_control_id?: string } };
      const id = json.data?.call_control_id;
      if (!id) throw new ProviderError('Telnyx did not return a call_control_id');
      return { callControlId: id };
    },

    async hangup(callControlId: string) {
      const res = await doFetch(`${base}/v2/calls/${encodeURIComponent(callControlId)}/actions/hangup`, {
        method: 'POST',
        headers,
        body: '{}',
      });
      // 404 / 422 = the call is already over.
      if (!res.ok && res.status !== 404 && res.status !== 422) {
        throw new ProviderError(`Telnyx hangup ${res.status}: ${await readErrorBody(res)}`, res.status);
      }
    },
  };
}

function friendlyDialError(status: number, detail: string): string {
  if (status === 401 || status === 403) return 'The phone provider rejected our credentials.';
  if (/destination|not allowed|whitelist|outbound voice profile/i.test(detail)) {
    return 'That country is not enabled for outbound calls on the phone provider account.';
  }
  if (/balance|insufficient|payment/i.test(detail)) return 'The phone provider account is out of balance.';
  return 'The phone provider could not place the call.';
}
