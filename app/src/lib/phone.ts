/** Phone-number helpers: formatting and a best-guess "what language do they speak?". */

export const CALLING_CODES: { prefix: string; country: string; flag: string; language: string }[] = [
  { prefix: '1', country: 'US/Canada', flag: '🇺🇸', language: 'en' },
  { prefix: '7', country: 'Russia', flag: '🇷🇺', language: 'ru' },
  { prefix: '20', country: 'Egypt', flag: '🇪🇬', language: 'ar' },
  { prefix: '27', country: 'South Africa', flag: '🇿🇦', language: 'en' },
  { prefix: '30', country: 'Greece', flag: '🇬🇷', language: 'el' },
  { prefix: '31', country: 'Netherlands', flag: '🇳🇱', language: 'nl' },
  { prefix: '33', country: 'France', flag: '🇫🇷', language: 'fr' },
  { prefix: '34', country: 'Spain', flag: '🇪🇸', language: 'es' },
  { prefix: '36', country: 'Hungary', flag: '🇭🇺', language: 'hu' },
  { prefix: '39', country: 'Italy', flag: '🇮🇹', language: 'it' },
  { prefix: '40', country: 'Romania', flag: '🇷🇴', language: 'ro' },
  { prefix: '43', country: 'Austria', flag: '🇦🇹', language: 'de' },
  { prefix: '44', country: 'United Kingdom', flag: '🇬🇧', language: 'en' },
  { prefix: '45', country: 'Denmark', flag: '🇩🇰', language: 'da' },
  { prefix: '46', country: 'Sweden', flag: '🇸🇪', language: 'sv' },
  { prefix: '47', country: 'Norway', flag: '🇳🇴', language: 'no' },
  { prefix: '48', country: 'Poland', flag: '🇵🇱', language: 'pl' },
  { prefix: '49', country: 'Germany', flag: '🇩🇪', language: 'de' },
  { prefix: '52', country: 'Mexico', flag: '🇲🇽', language: 'es' },
  { prefix: '55', country: 'Brazil', flag: '🇧🇷', language: 'pt' },
  { prefix: '60', country: 'Malaysia', flag: '🇲🇾', language: 'ms' },
  { prefix: '61', country: 'Australia', flag: '🇦🇺', language: 'en' },
  { prefix: '62', country: 'Indonesia', flag: '🇮🇩', language: 'id' },
  { prefix: '63', country: 'Philippines', flag: '🇵🇭', language: 'fil' },
  { prefix: '81', country: 'Japan', flag: '🇯🇵', language: 'ja' },
  { prefix: '82', country: 'South Korea', flag: '🇰🇷', language: 'ko' },
  { prefix: '84', country: 'Vietnam', flag: '🇻🇳', language: 'vi' },
  { prefix: '86', country: 'China', flag: '🇨🇳', language: 'zh' },
  { prefix: '90', country: 'Türkiye', flag: '🇹🇷', language: 'tr' },
  { prefix: '91', country: 'India', flag: '🇮🇳', language: 'hi' },
  { prefix: '254', country: 'Kenya', flag: '🇰🇪', language: 'en' },
  { prefix: '351', country: 'Portugal', flag: '🇵🇹', language: 'pt' },
  { prefix: '353', country: 'Ireland', flag: '🇮🇪', language: 'en' },
  { prefix: '358', country: 'Finland', flag: '🇫🇮', language: 'fi' },
  { prefix: '380', country: 'Ukraine', flag: '🇺🇦', language: 'uk' },
  { prefix: '420', country: 'Czechia', flag: '🇨🇿', language: 'cs' },
  { prefix: '421', country: 'Slovakia', flag: '🇸🇰', language: 'sk' },
  { prefix: '966', country: 'Saudi Arabia', flag: '🇸🇦', language: 'ar' },
  { prefix: '971', country: 'UAE', flag: '🇦🇪', language: 'ar' },
];

/** Keeps digits and a single leading "+". */
export function cleanPhone(input: string): string {
  const digits = input.replace(/[^\d]/g, '');
  return input.trim().startsWith('+') ? `+${digits}` : digits;
}

/** True for E.164: "+" and 8-15 digits. */
export function isValidE164(input: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(input);
}

/** Longest matching calling code for an E.164-ish number. */
export function matchCountry(input: string) {
  const n = cleanPhone(input);
  if (!n.startsWith('+')) return undefined;
  const digits = n.slice(1);
  return [...CALLING_CODES].sort((a, b) => b.prefix.length - a.prefix.length).find((c) => digits.startsWith(c.prefix));
}

export function suggestLanguage(input: string): string | undefined {
  return matchCountry(input)?.language;
}

/** "+36301234567" -> "+36 30 123 4567" (best-effort, display only). */
export function formatPhone(input: string): string {
  const n = cleanPhone(input);
  if (!n.startsWith('+')) return n;
  const c = matchCountry(n);
  if (!c) return n;
  const rest = n.slice(1 + c.prefix.length);
  const groups: string[] = [];
  let i = 0;
  const sizes = c.prefix === '1' ? [3, 3, 4] : [2, 3, 4, 4];
  for (const s of sizes) {
    if (i >= rest.length) break;
    groups.push(rest.slice(i, i + s));
    i += s;
  }
  if (i < rest.length) groups.push(rest.slice(i));
  return `+${c.prefix} ${groups.join(' ')}`.trim();
}
