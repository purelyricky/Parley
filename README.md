# Parley

Talk to anyone in any language. You speak yours, they hear theirs, **in your own cloned voice**.

- **Phone calls**: only *you* install the app. You dial a normal phone number, your friend picks up their
  ordinary phone and hears the translation in your voice.
- **App ↔ app calls**: two Parley users call each other over the internet by username, like FaceTime,
  with translation switchable on or off during the call.
- **Always disclosed**: the person on the phone hears a short spoken notice, in their language, that the
  call is translated by AI. The app shows a banner.

```
 Your phone (Parley app)                     Your Parley server                     Your friend
 ───────────────────────  PCM audio / JSON  ────────────────────  Telnyx media ───  ───────────
 mic ──────────────────────────────────────▶  STT ─▶ Claude ─▶ TTS (your voice) ──▶  phone speaker
 speaker ◀──────────────────────────────────  TTS (default voice) ◀ Claude ◀ STT ◀──  phone mic
```

| Piece | Choice | Why |
|---|---|---|
| Speech-to-text | ElevenLabs **Scribe v2 Realtime** | streaming, ~100 languages, auto sentence ends (VAD) |
| Voice cloning | ElevenLabs **Instant Voice Cloning** | 1 min of audio, included in the $6/mo Starter plan, no per-clone fee |
| Text-to-speech | ElevenLabs **Flash v2.5** | ~75 ms model latency, 32 languages, can output phone-grade μ-law directly |
| Translation | **Claude Haiku** (`TRANSLATION_MODEL`) | fast, cheap, keeps tone; guarded against prompt injection |
| Telephony | **Telnyx** | cheapest programmable voice with bidirectional media streaming and PCMU, no per-stream surcharge games |
| App | **Expo / React Native** | one codebase, dark modern UI, mascot |

One ElevenLabs key covers STT + cloning + TTS, which keeps setup to three accounts: ElevenLabs, Anthropic, Telnyx.

---

## 1. What it costs

Verify current prices before you rely on them: they change.

**Fixed**

| Item | Cost |
|---|---|
| ElevenLabs Starter (needed for cloning) | ~$6/mo (Creator $22/mo if you outgrow the credits) |
| Telnyx number (US) | ~$1/mo |
| Telnyx account top-up | $5-10 to start |
| Server | free on your laptop (ngrok free tier) |

**Per call minute** (both people talking part of the time; rough, ±40%)

| | Phone call | App ↔ app |
|---|---|---|
| Telnyx voice + SIP + streaming | ≈ $0.0105 US (other countries vary; **check Hungary**) | – |
| ElevenLabs STT (Scribe Realtime ≈ $0.39/h) | ≈ $0.007 | ≈ $0.007 |
| ElevenLabs TTS (Flash ≈ $0.04-0.05 / 1k chars, ~750 chars/min) | ≈ $0.04 | ≈ $0.04 |
| Claude Haiku translation | < $0.005 (not verified) | < $0.005 |
| **Total** | **≈ $0.065/min → ≈ $0.65 per 10-min call** | **≈ $0.05/min** |

Your friend's call is charged by Telnyx at the destination country's rate, which can be several times the
US rate for mobiles. Look up your friend's country on Telnyx's *Voice pricing* page first.

Cost guards are built in (`.env`): `MAX_CALL_MINUTES`, `MAX_CONCURRENT_CALLS`, `PHONE_CALLS_PER_HOUR`,
`ALLOWED_DIAL_PREFIXES`.

---

## 2. Set up the server (≈ 20 minutes)

You need Node 22+.

### 2.1 ElevenLabs
1. Create an account and subscribe to **Starter** or higher (voice cloning is not on the free plan).
2. Settings → **API Keys** → create a key → `ELEVENLABS_API_KEY`.
3. *(Optional)* Voices → pick a neutral voice, add it to *My voices*, copy its ID into `DEFAULT_VOICE_ID`.
   This is the voice **you** hear when your friend's speech is translated for you (they haven't cloned
   theirs). Pick one in your own language's register, e.g. a calm neutral voice.

### 2.2 Anthropic
Create a key at console.anthropic.com → `ANTHROPIC_API_KEY`. Add a few dollars of credit.

### 2.3 Telnyx (phone calls only)
Skip this section to test app ↔ app and the mirror test first.

1. Sign up at telnyx.com and complete verification. Add credit (Billing → Payment).
2. **Buy a number**: Numbers → *Buy Numbers* → pick a voice-capable number. This is your caller ID.
   (Some countries require identity documents before you can buy; a US number is the fastest.)
3. **Create a Voice API application** (called *Call Control* in some menus):
   Voice → *Programmable Voice* (or *Voice API*) → *Applications* → **Add new application**.
   - Webhook URL: `https://<your PUBLIC_URL>/telnyx/webhook` (see 2.4)
   - API version: **v2**
   - Save, then copy the application's **ID** → `TELNYX_CONNECTION_ID`.
4. **Attach the number to the application**: Numbers → *My Numbers* → your number → Voice → choose the
   application from step 3. `TELNYX_FROM_NUMBER` is that number in `+E.164` format.
5. **Allow outbound calls**: Voice → *Outbound Voice Profiles* → create/edit a profile, enable the
   **destination countries** you will call (e.g. Hungary), and assign the profile to your application
   (application → *Outbound* tab).
6. **API key**: Account → *API Keys* → create a v2 key → `TELNYX_API_KEY`.

Menu names shift occasionally; `npm run doctor` (below) tells you precisely which part is wrong.
Trial accounts may only call numbers you have verified in Telnyx: add your friend's number there, or add credit to lift it.

### 2.3b Public URL
Telnyx must reach your laptop. Use a tunnel:

```bash
ngrok http 8080          # or: cloudflared tunnel --url http://localhost:8080
```
Copy the `https://….ngrok-free.app` address (no trailing slash) → `PUBLIC_URL`, and paste it into the
Telnyx application's webhook URL as `…/telnyx/webhook`. Free ngrok URLs change each time you restart
it: update both places when that happens.

### 2.4 Run it

```bash
cd server
npm install
cp .env.example .env        # fill in the keys above
npm run doctor              # checks every key, the plan, the number and the public URL
npm run dev
```
`npm run doctor` must be all green before you try a call. The server prints the URL to enter in the app.

---

## 3. Run the app

The app uses native audio code, so it **does not work in Expo Go**: you need a development build.

```bash
cd app
npm install
cp .env.example .env        # optional: set EXPO_PUBLIC_SERVER_URL to your ngrok URL
```

**Android** (phone via USB with debugging on, or an emulator; needs Android Studio's SDK):
```bash
npx expo run:android
```
**iPhone** (needs a Mac with Xcode):
```bash
npx expo run:ios --device
```
**No Mac / no Android SDK?** Build in the cloud:
```bash
npx eas-cli@latest login
npx eas-cli@latest build --profile development --platform android   # or ios
```
Install the result on your phone, then `npx expo start --dev-client` and open it.

First launch walks you through onboarding:
1. Enter your server address (your ngrok URL), choose a username and the language you speak.
2. Read the on-screen text for about a minute (quiet room): this creates your voice clone.
3. Hear yourself speak another language, then **Start talking**.

---

## 4. Test it live (do these in order)

Use **headphones** for every test, otherwise the speaker's translation leaks back into the mic.

1. **Mirror test** (Call tab → *Test*): pick a target language and talk. You should see your captions, then
   hear the translation in your own voice. If this works, ElevenLabs + Claude + your voice are good.
2. **App ↔ app**: install the app on a second phone (or ask a friend), register another username, and call
   `@theirname` from the Username tab. Switch translation on and off mid-call from the call screen.
3. **Phone call to your friend**: Phone tab, type their number with country code (`+36…`), check the
   language Parley guessed, press **Call**. When they answer they hear the AI notice in their language, then
   you can talk. Keep the app open and on screen: calls drop if the app is closed (see limits).

Tell your friend to speak in full sentences and pause briefly: translation starts when a sentence ends
(~0.7 s of silence, `VAD_SILENCE_SECS`). Expect about 1.5-3 s of delay per sentence.

### Troubleshooting

| Symptom | Fix |
|---|---|
| App says it can't reach the server | Server not running, wrong/old ngrok URL, or phone on a different network from a LAN address. Use the ngrok URL. |
| "Voice cloning is not available on the configured plan" | Upgrade ElevenLabs to Starter+. |
| Phone tab says phone calls aren't set up | Telnyx values missing in `.env`; run `npm run doctor`. |
| Call fails instantly / "couldn't connect" | Destination country not enabled on the outbound voice profile, or no Telnyx credit. |
| Phone rings but there's silence | `PUBLIC_URL` stale or wrong (Telnyx can't open the audio stream). Update `.env`, restart, and update the webhook. |
| Friend hears echo / double voices | Use headphones; also ask your friend not to use speakerphone. |
| Captions appear but nothing is spoken | Check the phone's volume and that the call screen isn't muted; check server logs for TTS errors. |
| Cut off mid-sentence | Raise `VAD_SILENCE_SECS` to 1.0. |
| Voice doesn't sound like me | Re-record in You → *Record again*: quiet room, natural pace, 60 s. |

---

## 5. Tests

```bash
cd server && npm test      # 138 tests: audio, STT/TTS/translation, call routing, HTTP API, end-to-end with simulated Telnyx
cd app && npm test         # 29 tests: audio math, WAV, phone parsing, reducer, API client, WebSocket reconnect
npm run typecheck          # in both folders
```
The suites use fakes for ElevenLabs, Claude and Telnyx, so they run offline and cost nothing.
They do **not** replace the live test in section 4.

---

## 6. Privacy & consent

- A voice clone is only created after the user ticks consent, and only from their own recording.
- The clone and the account can be deleted any time (You tab); deleting removes the voice at ElevenLabs too.
- The person on the phone is told, in their language, that the call is AI-translated, at the start of every call.
- Audio is streamed to ElevenLabs and text to Anthropic for processing; this server stores no call audio or
  transcripts, only usernames, languages, a token and the voice ID (`server/data/`).
- Laws on call recording/AI voices differ per country: you're not recording here, but check the rules for
  anything beyond personal testing.

## 7. Mascot & licence

The mascot is **Strobi** from [bible-strong-avatar-lab](https://github.com/smontlouis/bible-strong-avatar-lab),
which is **AGPL-3.0-only**. Using it means the app must be released under the AGPL if you distribute it
(store release, sharing the APK). Fine for testing on your own phone. To ship closed-source, swap the
mascot: see `NOTICE.md` (it's isolated in one component).

## 8. Known limits (it's a first version)

- **Keep the app in the foreground** during calls; there are no push notifications, so someone only receives an app
  call while their Parley app is open.
- Authentication is a single secret token per device. Losing the phone data = losing the account.
- The Telnyx webhook isn't signature-verified yet; don't expose the server beyond testing.
- One call at a time per user; no group calls.
- Only the app user's voice is cloned. What a phone friend says is translated and spoken to you in the
  `DEFAULT_VOICE_ID` voice (plus captions). Two app users each hear the other in their own cloned voice.
- Calls to some countries (e.g. Hungary) cost more than US rates: check Telnyx pricing.
- The app UI and live audio have been verified by type-checking, unit tests and a production bundle only. They
  were not run on a physical device while building this, so expect small rough edges on first launch.

## Layout

```
server/   Node + TypeScript: HTTP API, WebSocket, call routing, ElevenLabs / Claude / Telnyx providers, tests
app/      Expo (React Native): onboarding, call UI, audio, mascot, tests
```
