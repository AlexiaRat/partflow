/**
 * Auto-reply detection.
 *
 * Out-of-office responders are a classic auto-loop trap for email automation.
 * We detect them via header patterns (RFC 3834 in production) or via copy
 * pattern matching on the subject and body for demo emails.
 *
 * The German patterns are loose enough to catch "Ich bin vom 1. bis 15. im
 * Urlaub" (very common phrasing), which the previous strict pattern missed.
 */

const SUBJECT_PATTERNS = [
  // NB: the multi-Re catcher used to fire on any subject starting with
  // "Re: Re:" which produced false positives on legitimate threaded replies
  // and on demo subjects starting with "Re: Re: Re: ...". Require at least
  // three Re prefixes AND another OOO signal, or treat it as not-an-auto-reply.
  /\b(out of office|out-of-office|ooo)\b/i,
  /\b(automatic reply|auto.?reply|autoresponder|autoresponse)\b/i,
  /\bvacation\b.*\b(reply|response|message|notice)\b/i,
  /undeliverable/i,
  /mail delivery (failed|notification)/i,
  /\b(absent|en cong[ée])\b/i,       // FR
  /\babwesenheits/i,                  // DE "Abwesenheitsnotiz"
  /raspuns automat/i,                 // RO
  /sunt in concediu/i,                // RO
];

const BODY_PATTERNS = [
  /i am (currently |out of |away from) (the )?office/i,
  /i('m| am| will be) (out|away|absent) (of|from) (the )?(office|town) (until|from)/i,
  /thank you for your (email|message)\.?\s+(i am|i'm) (currently |now |out)/i,
  /sunt (in concediu|plecat|absent) p[âa]n[ăa]/i,
  // German: allow content between "vom" and "urlaub" (date ranges)
  /ich bin\b[\s\S]{0,80}\b(im urlaub|au[ßs]er haus|abwesend)/i,
  /vielen dank f[uü]r ihre nachricht[\s\S]{0,60}(im urlaub|abwesend)/i,
  /je suis\b[\s\S]{0,80}\b(en cong[ée]|absent[e]?)\s+jusqu/i,
];

export function detectAutoReply(subject: string, body: string): boolean {
  for (const p of SUBJECT_PATTERNS) {
    if (p.test(subject)) return true;
  }
  for (const p of BODY_PATTERNS) {
    if (p.test(body)) return true;
  }
  return false;
}
