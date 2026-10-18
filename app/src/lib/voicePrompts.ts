/** Read-aloud passages for voice cloning. Natural, varied sentences make a better clone. */
export const VOICE_PROMPTS: string[] = [
  "Hi, this is me, speaking the way I normally do. I'm recording a short sample so that the people I talk to can hear my own voice, even when they speak a different language.",
  "Yesterday I walked down to the market and picked up some fresh bread, a handful of tomatoes, and far too many peaches. The weather was warm, the street was busy, and nobody seemed to be in a hurry.",
  "If you ask me what I like most about travelling, it's the small surprises: a stranger who points you the right way, a dish you can't pronounce, a conversation that goes on much longer than planned.",
  "Could you tell me what time the train leaves? I'd like to be there early, just in case. And please, don't forget to bring the blue umbrella, because it looks like it might rain this evening!",
  "Technology is only useful when it gets out of the way. I want to pick up the phone, say what I mean, and have the other person understand me, with warmth and with my own voice.",
  "Numbers help too: one, two, three, four, five, six, seven, eight, nine, ten. Monday, Tuesday, Wednesday, Thursday, Friday. Really? That's wonderful news. Wait, are you serious?",
];

export const MIN_SECONDS = 30;
export const TARGET_SECONDS = 60;
export const MAX_SECONDS = 120;

export function promptForElapsed(elapsedSeconds: number): number {
  return Math.min(VOICE_PROMPTS.length - 1, Math.floor(elapsedSeconds / 12));
}
