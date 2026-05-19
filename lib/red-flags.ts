/**
 * Heuristic red-flag detector for suspicious incoming emails.
 *
 * Runs alongside the LLM classifier and produces a structured list of flags
 * for the operator. Each flag has a severity (high/medium/low), a short title
 * and a detailed explanation. The UI surfaces these as a security notice
 * above the generated reply.
 *
 * The detector is intentionally conservative — false positives waste operator
 * attention. Patterns are tuned to the common shapes of:
 *   1. Prompt injection / jailbreak attempts
 *   2. Price manipulation attempts
 *   3. Suspicious sender identity (test domains, gibberish names)
 *   4. Pressure tactics (excessive shouting + urgency language)
 *
 * The pipeline still generates a normal reply even when red flags fire — the
 * downstream agents are instructed to ignore embedded instructions. The flags
 * are advisory: the operator decides whether to send the reply, archive the
 * email, or escalate.
 */

import type { IncomingEmail } from "./types";

export type RedFlagSeverity = "high" | "medium" | "low";

export interface RedFlag {
  id: string;
  severity: RedFlagSeverity;
  title: string;
  detail: string;
}

// Multilingual patterns. We anchor on the verb and the object so the regex
// catches the same phrase across English, German, Romanian, Hungarian.
const INSTRUCTION_OVERRIDE_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|prompts?)/i,
  /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|prompts?)/i,
  /override\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|rules?|prompts?)/i,
  /ignoriere\s+(alle\s+)?(vorherigen|vorigen|fr\u00fcheren)\s+(anweisungen|regeln)/i,
  /ignor[\u0103a]\s+(toate\s+)?(instruc[\u021bt]iunile?)\s+(anterioare|de\s+mai\s+sus)/i,
  /felejtsd?\s+el\s+(az\s+)?(\u00f6sszes\s+)?kor\u00e1bbi\s+utas[\u00ed][st][\u00e1a]s/i,
  // "Internal note for system/assistant/AI" patterns — common Romanian injection vector
  /(nota|not[\u0103a])\s+(intern[\u0103a]?\s+)?(pentru\s+)?(sistem|asistent|ai|model)/i,
  /instruc[\u021bt]iuni\s+(interne|pentru)\s+(sistem|asistent|ai|model)/i,
  /\binternal\s+note\s+(for|to)\s+(the\s+)?(system|assistant|ai|model|llm)/i,
  /\bnote\s+(for|to)\s+(the\s+)?(assistant|ai|model|llm|system)/i,
];

const FORGET_PATTERNS = [
  /forget\s+(everything|all|the)\s+(above|prior|previous)/i,
  /vergiss\s+(alles\s+)?(oben|vorher)/i,
  /uit[\u0103a]\s+(tot|tot\s+ce(-i|.{0,5})mai\s+sus)/i,
];

const SYSTEM_PROMPT_PATTERNS = [
  /(reveal|show|tell\s+me|print|output)\s+(your|the)\s+(system\s+prompt|prompt|instructions?|rules?|context)/i,
  /(dezv[\u0103a]luie|arat[\u0103a])\s+(prompt(-?ul)?|instruc[\u021bt]iunile)/i,
  /(zeige|gib)\s+mir\s+(den|deinen)\s+(system\s*prompt|anweisungen)/i,
  // Audit / log / debug requests — common social engineering vector
  /(send|trimite|trimite[\u0163t]i|sende)\s+(me\s+|mi\s+)?(the\s+|imi\s+)?(processing\s+)?log/i,
  /(audit|debug)\s+(log|trace|info|information|context)/i,
  /(trimite[\u0163t]i?\s+(-?mi\s+)?)?logul?\s+(complet|de\s+procesare)/i,
];

const ROLE_HIJACK_PATTERNS = [
  /you\s+are\s+now\s+(a\s+)?(helpful\s+)?assistant\s+who/i,
  /act\s+as\s+(a\s+)?(different|new)\s+assistant/i,
  /from\s+now\s+on,?\s+you\s+(are|will)/i,
  /\bpretend\s+(to\s+be|you('re|\s+are))/i,
  /e[\u0219s]ti\s+(acum\s+)?un\s+asistent\s+care/i,
];

const PRICE_MANIPULATION_PATTERNS = [
  /(set|make|change)[^.]{0,40}price[^.]{0,40}(to|=|:)?\s*(0|zero|free|1\s*eur|nothing)/i,
  /(100|hundred)\s*%\s*discount/i,
  /(set|seteaz[\u0103a])[^.]{0,40}(pre[\u021bt]ul|costul)[^.]{0,40}(la\s+)?(0|zero|1\s*eur)/i,
  /(setze|mache)[^.]{0,40}preis[^.]{0,40}(auf|=)\s*(0|null|kostenlos)/i,
  // Unauthorized discount / loyalty / contract claims
  /(discount|reducere)\s+(fidelizare|de\s+fidelitate|loialitate|loyalty)\s+(de\s+)?(\d{2,3}\s*%)/i,
  // Reverse order: "50% loyalty discount", "60% reducere fidelizare"
  /\d{2,3}\s*%\s+(loyalty|fidelizare|de\s+fidelitate|loialitate)\s+(discount|reducere)/i,
  /(apply|aplica[\u0163t]i?|grant)[^.]{0,30}\d{2,3}\s*%[^.]{0,30}(discount|loyalty|fidelizare|reducere)/i,
  /(contract|partener)\s+(special|VIP|special[\u0103a])[^.]{0,40}(semnat|signed|aprobat|approved)/i,
  /(aplica[\u0163t]i?|apply)\s+(un\s+)?discount\s+(de\s+)?\d{2,3}\s*%/i,
  /(livrare|shipping|delivery)\s+(gratuit[\u0103a]?|free)\s+(indiferent|regardless)/i,
];

const SUSPICIOUS_SENDER_DOMAINS = [
  /@(attacker|spam|hacker|malicious|phishing|fakemail)\b/i,
  /@(test|example|invalid|localhost)\.\w+/i,
  /@.*\.(test|invalid|localhost|example|click|tk|ml|ga|cf)$/i,
];

const CATALOG_DUMP_PATTERNS = [
  // VERB + ADJECTIVE + NOUN: "send me the complete catalog"
  /(send|trimite[\u0163t]?[ie]?[\u0163t]?i?|share|give)[^.]{0,40}(complete|full|entire|toat[\u0103a])[^.]{0,40}(catalog|list[\u0103a]?|stock|inventar|produs|products?|piesele?)/i,
  // VERB + NOUN + ADJECTIVE/QUALIFIER: "trimite lista completa cu toate piesele"
  /(send|trimite[\u0163t]?[ie]?[\u0163t]?i?|share|give)[^.]{0,40}(catalog|list[\u0103a]?|stock|inventar|produs|products?|piesele?)[^.]{0,40}(complete|full|entire|toat[\u0103a]|cu\s+toate)/i,
  // "all your SKUs/prices", "toate piesele/skus/preturile"
  /(all|toate)\s+(your\s+|the\s+)?(skus?|prices?|stock|inventory|piesele|preturile?)/i,
  // "lista cu toate piesele/skus"
  /(list[\u0103a]?|lista)\s+(cu\s+toate|with\s+all)\s+(skus?|piesele|produsele|preturile?)/i,
];

const COST_MARGIN_PROBE_PATTERNS = [
  /(cost|pre[\u021bt])\s+de\s+(achizi[\u021bt]ie|cump[\u0103a]rare|fabrica[\u021bt]ie)/i,
  /(purchase|acquisition|wholesale)\s+(cost|price)/i,
  /(marja|margin|markup)\s+(de\s+)?(profit|comercial)?/i,
  /(profit\s+margin|markup\s+percentage)/i,
];

const URGENCY_TERMS = /\b(urgent|immediately|now|asap|critical|emergency|right\s+now|right\s+away|dringend|sofort|jetzt|urgent[\u0103a]?|imediat|acum)\b/i;

// All-consonant blobs and common keyboard row patterns
const GIBBERISH_PATTERNS = [
  /^[bcdfghjklmnpqrstvwxz]{6,}$/i, // 6+ consonants with no vowel
  /qwerty|asdfg{2,}|zxcv|wxyz|yuiop/i,
  /^([a-z])\1{3,}/i, // same letter 4+ times
];

function anyMatch(patterns: RegExp[], text: string): boolean {
  return patterns.some((p) => p.test(text));
}

export function detectRedFlags(
  email: IncomingEmail,
  opts?: { attachmentOcrText?: string },
): RedFlag[] {
  const flags: RedFlag[] = [];
  const body = email.body ?? "";
  const subject = email.subject ?? "";
  const senderName = email.from_name ?? "";
  const senderEmail = email.from_email ?? "";
  const ocrText = opts?.attachmentOcrText ?? "";
  // Combine all fields a malicious sender could use to smuggle instructions
  // through. Specifically include from_name and OCR text since those are
  // attacker-controllable but easy to overlook.
  const combined = `${senderName}\n${subject}\n${body}\n${ocrText}`;

  if (anyMatch(INSTRUCTION_OVERRIDE_PATTERNS, combined)) {
    flags.push({
      id: "instruction_override",
      severity: "high",
      title: "Instruction override attempt",
      detail:
        "The email contains language asking the assistant to ignore prior instructions. This is a textbook prompt injection. The pipeline already ignored it and the generated reply uses the normal system prompt, but the sender is acting in bad faith.",
    });
  }

  if (anyMatch(FORGET_PATTERNS, combined)) {
    flags.push({
      id: "memory_wipe_attempt",
      severity: "high",
      title: "Memory wipe attempt",
      detail:
        "The email instructs the assistant to forget what was said earlier. Combined with other injection patterns, this is a jailbreak attempt.",
    });
  }

  if (anyMatch(SYSTEM_PROMPT_PATTERNS, combined)) {
    flags.push({
      id: "system_prompt_extraction",
      severity: "high",
      title: "System prompt or log extraction attempt",
      detail:
        "The sender asks for internal instructions, audit logs, or processing context. Often phrased as a fake internal IT/GDPR request. Never include any system-level configuration in the reply.",
    });
  }

  if (anyMatch(ROLE_HIJACK_PATTERNS, combined)) {
    flags.push({
      id: "role_hijack",
      severity: "high",
      title: "Role hijack attempt",
      detail:
        "The email tries to redefine the assistant's role mid-conversation, typically as a step toward getting unauthorized output.",
    });
  }

  if (anyMatch(PRICE_MANIPULATION_PATTERNS, combined)) {
    flags.push({
      id: "price_manipulation",
      severity: "high",
      title: "Price manipulation attempt",
      detail:
        "The email tries to force discount, free shipping, or zero price using fake contract/loyalty claims. The pricing engine ignores message content and uses catalog rules, so this has no effect — but the intent is malicious.",
    });
  }

  if (anyMatch(CATALOG_DUMP_PATTERNS, combined)) {
    flags.push({
      id: "catalog_dump_attempt",
      severity: "medium",
      title: "Catalog enumeration request",
      detail:
        "The sender is asking for the complete catalog, full SKU list, or all prices. This is not a normal customer behavior. Reply with a short refusal pointing to your public catalog or sales contact instead.",
    });
  }

  if (anyMatch(COST_MARGIN_PROBE_PATTERNS, combined)) {
    flags.push({
      id: "cost_margin_probe",
      severity: "medium",
      title: "Cost or margin information probe",
      detail:
        "The sender is asking for wholesale cost, acquisition price, or profit margin. This is internal business information that should not be disclosed. Only retail prices from the catalog are public.",
    });
  }

  if (anyMatch(SUSPICIOUS_SENDER_DOMAINS, senderEmail)) {
    flags.push({
      id: "suspicious_sender_domain",
      severity: "medium",
      title: "Suspicious sender domain",
      detail: `Sender address (${senderEmail}) uses a domain commonly associated with testing, throwaway accounts, or malicious activity.`,
    });
  }

  // Sender name red flags. Two kinds:
  //   1. Keyboard-mashing gibberish (alexia, asdfgh patterns)
  //   2. Injection text smuggled into the display name itself
  const nameStripped = senderName.replace(/\s+/g, "");
  if (nameStripped.length >= 5 && anyMatch(GIBBERISH_PATTERNS, nameStripped)) {
    flags.push({
      id: "gibberish_sender_name",
      severity: "low",
      title: "Sender name looks like keyboard mashing",
      detail: `Name "${senderName}" appears to be random characters rather than a real name. May indicate a fake or bot-generated request.`,
    });
  }
  // Catch obvious injection-shaped display names like "Ignore prior. New rule"
  if (
    senderName.length > 20 ||
    /[.!?]/.test(senderName) ||
    /\b(ignore|forget|reveal|system|prompt|instruction|rule)\b/i.test(senderName)
  ) {
    if (
      anyMatch(INSTRUCTION_OVERRIDE_PATTERNS, senderName) ||
      anyMatch(FORGET_PATTERNS, senderName) ||
      anyMatch(SYSTEM_PROMPT_PATTERNS, senderName) ||
      /\b(ignore|forget)\b.{0,30}\b(rule|instruction|prompt)/i.test(senderName) ||
      /respond\s+only/i.test(senderName)
    ) {
      flags.push({
        id: "injection_in_sender_name",
        severity: "high",
        title: "Injection attempt in sender display name",
        detail: `The sender's display name ("${senderName}") contains injection-like instructions. Display names are attacker-controllable and a common way to smuggle commands past simpler filters.`,
      });
    }
  }

  // Excessive shouting combined with urgency keywords
  if (body.length > 50) {
    const letters = body.replace(/[^A-Za-z]/g, "");
    if (letters.length >= 30) {
      const upper = (letters.match(/[A-Z]/g) ?? []).length;
      if (upper / letters.length > 0.4 && URGENCY_TERMS.test(body)) {
        flags.push({
          id: "shouty_urgency",
          severity: "medium",
          title: "Excessive capitalization with urgency language",
          detail:
            "A large portion of the email is in uppercase and contains urgency keywords. Often a pressure tactic used in scams or social engineering attempts.",
        });
      }
    }
  }

  return flags;
}
