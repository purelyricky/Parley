/**
 * Languages offered in the app. This is the set supported by ElevenLabs Flash v2.5
 * (text-to-speech) and Scribe (speech-to-text), so every language here can be both
 * heard and spoken.
 */
export interface Language {
  code: string;
  name: string;
  native: string;
  flag: string;
}

export const LANGUAGES: readonly Language[] = [
  { code: 'en', name: 'English', native: 'English', flag: '🇬🇧' },
  { code: 'hu', name: 'Hungarian', native: 'Magyar', flag: '🇭🇺' },
  { code: 'es', name: 'Spanish', native: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'French', native: 'Français', flag: '🇫🇷' },
  { code: 'de', name: 'German', native: 'Deutsch', flag: '🇩🇪' },
  { code: 'it', name: 'Italian', native: 'Italiano', flag: '🇮🇹' },
  { code: 'pt', name: 'Portuguese', native: 'Português', flag: '🇵🇹' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands', flag: '🇳🇱' },
  { code: 'pl', name: 'Polish', native: 'Polski', flag: '🇵🇱' },
  { code: 'ro', name: 'Romanian', native: 'Română', flag: '🇷🇴' },
  { code: 'cs', name: 'Czech', native: 'Čeština', flag: '🇨🇿' },
  { code: 'sk', name: 'Slovak', native: 'Slovenčina', flag: '🇸🇰' },
  { code: 'hr', name: 'Croatian', native: 'Hrvatski', flag: '🇭🇷' },
  { code: 'bg', name: 'Bulgarian', native: 'Български', flag: '🇧🇬' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά', flag: '🇬🇷' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська', flag: '🇺🇦' },
  { code: 'ru', name: 'Russian', native: 'Русский', flag: '🇷🇺' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe', flag: '🇹🇷' },
  { code: 'ar', name: 'Arabic', native: 'العربية', flag: '🇸🇦' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', flag: '🇮🇳' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்', flag: '🇮🇳' },
  { code: 'zh', name: 'Chinese', native: '中文', flag: '🇨🇳' },
  { code: 'ja', name: 'Japanese', native: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: 'Korean', native: '한국어', flag: '🇰🇷' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu', flag: '🇲🇾' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'fil', name: 'Filipino', native: 'Filipino', flag: '🇵🇭' },
  { code: 'sv', name: 'Swedish', native: 'Svenska', flag: '🇸🇪' },
  { code: 'da', name: 'Danish', native: 'Dansk', flag: '🇩🇰' },
  { code: 'no', name: 'Norwegian', native: 'Norsk', flag: '🇳🇴' },
  { code: 'fi', name: 'Finnish', native: 'Suomi', flag: '🇫🇮' },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function isSupportedLanguage(code: string): boolean {
  return BY_CODE.has(code);
}

export function languageName(code: string): string {
  return BY_CODE.get(code)?.name ?? code;
}
