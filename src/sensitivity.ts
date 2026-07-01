// Content-based sensitivity classifier — the fail-closed half of the privacy rule.
// The seat-locality gate (selectSeats) only acts when the caller remembers to pass
// sensitivity="private". This classifier inspects the actual prompt so that a forgotten
// flag still fails CLOSED: estate / legal / finance / identity content is auto-detected and
// forced local-only, and single-seat cloud tools refuse outright. It only ROUTES — it never
// deletes user text.
//
// Kept deliberately in sync with the checkpoint writer's SENSITIVE_RE
// (scripts/checkpoint-active-work.mjs): Traditional + Simplified + variants + plain English +
// HKID number shape. Over-flagging is the safe failure here, so the net is intentionally wide.
// Keep broad and conservative: over-flagging is safer than leaking sensitive prompts to cloud seats.
const SENSITIVE_RE =
  /(遺產|遗产|代位繼承|代位继承|繼承|继承|遺囑|遗嘱|遺產管理|遗产管理|intestate|probate|inherit(?:ance)?|estate|限期|時效|时效|limitation period|administrator|身份證|身分證|护照|護照|passport|HKID|MPF|強積金|强积金|遺產稅|bank account|銀行帳|银行账|帳戶|账户|legal|法律|payment|pay|credit card|[A-Z]{1,2}[0-9]{6}\([0-9A]\))/i;

export function isSensitive(text: string): boolean {
  return SENSITIVE_RE.test(text ?? "");
}
