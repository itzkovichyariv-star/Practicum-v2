/**
 * An employer's people — several of them, one of them active.
 *
 * Yariv 2026-09-15: "הרבה פעמים איש הקשר יוצא לחופשה ובאופן זמני צריך להחליפו ואז
 * להחזיר… והבחירה באיש הקשר תנתב אליו את כל המידע והדפים כולל חוות דעת, טפסי קורות
 * חיים וכו׳."
 *
 * THE DESIGN, and why it is this one. An employer record has carried exactly three
 * contact fields — `contactPerson`, `contactPhone`, `contactEmail` — since the
 * beginning, and by now something like thirty places read them: the CV send and its
 * reminder, the withdrawal message, the feedback request and the employer's own
 * feedback page, the evaluation form, the placement strip's dialog and its ⓘ popover,
 * the student row's call/WhatsApp/mail icons, the employers page, the exports.
 *
 * So the list of people is added ALONGSIDE those fields, and the active person is
 * MIRRORED INTO them. Switching Codeoasis from one person to their stand-in rewrites
 * the three fields, and every one of those thirty readers follows without knowing this
 * module exists. It is the same compat-shim shape the student's ranked organizations
 * already use (`applyUnifiedList` keeps the legacy `*ChoiceOrg` fields in sync), and it
 * is what makes "route everything to them" true rather than a list of places to go and
 * change.
 *
 * Nothing is destroyed by a switch: the person who went on holiday keeps their own card
 * with their own number, and coming back is one tap on their card.
 *
 * An employer that has never been edited here has no list at all — so the list is
 * DERIVED on read from the three fields, exactly the way the unified organization list
 * is derived from the legacy choice fields. No migration, and an employer saved by an
 * older build still reads correctly.
 */

export type EmployerContact = {
  id: string;
  name: string;
  /** "מנהלת משאבי אנוש", "מחליפה בחופשת לידה" — free text, shown beside the name. */
  role?: string;
  phone?: string;
  email?: string;
  /** "בחופשה עד 1.10", "לפניות דחופות בלבד" — for the coordinator, never sent. */
  note?: string;
};

type WithContacts = {
  contactPerson?: string; contactPhone?: string; contactEmail?: string;
  contacts?: EmployerContact[];
  activeContactId?: string | null;
};

/** The id the derived first contact carries, so a switch away and back is stable. */
export const PRIMARY_CONTACT_ID = 'primary';

const str = (v: unknown) => String(v ?? '').trim();
/**
 * A field as the coordinator typed it, kept EXACTLY.
 *
 * Every write goes through `applyContacts`, and the card's inputs call it on each
 * keystroke — so trimming a field here trimmed it between one keystroke and the next.
 * Pressing space at the end of a word deleted the space before it could be seen, and
 * "רונית לוי" could not be typed at all; a space put back BETWEEN two words survived,
 * because there it is no longer trailing. Yariv 2026-09-15: "הקלדה בשדות אינה מאפשרת
 * רווח … ניתן לייצר רווח בין מילים לאחר כתיבה אבל לא בעת הקלדה."
 *
 * Whitespace is therefore decided at the two edges where it matters, never mid-typing:
 * `contactIsEmpty` still asks with `str`, so a card of spaces is still empty; the three
 * mirrored fields are still written trimmed, so nothing downstream ever sends a stray
 * space; and `normalizeContacts` tidies the stored list once, on save.
 */
const keep = (v: unknown) => String(v ?? '');

/** Does this card hold anything at all? An empty card is not a person. */
export function contactIsEmpty(c: Partial<EmployerContact> | null | undefined): boolean {
  return !str(c?.name) && !str(c?.phone) && !str(c?.email);
}

/**
 * Every contact on the employer, in order, always reflecting what is stored.
 *
 * With no list, the three flat fields ARE the one contact. With a list, the flat fields
 * are its mirror and add nothing.
 */
export function employerContacts(emp: WithContacts | null | undefined): EmployerContact[] {
  const stored = Array.isArray(emp?.contacts) ? emp!.contacts! : [];
  const cleaned = stored
    .filter(c => !!c && !!str(c.id))
    .map(c => ({ id: str(c.id), name: keep(c.name), role: keep(c.role), phone: keep(c.phone), email: keep(c.email), note: keep(c.note) }));
  if (cleaned.length) return cleaned;

  const derived: EmployerContact = {
    id: PRIMARY_CONTACT_ID,
    name: str(emp?.contactPerson), role: '',
    phone: str(emp?.contactPhone), email: str(emp?.contactEmail), note: '',
  };
  return contactIsEmpty(derived) ? [] : [derived];
}

/** The id of the contact everything is routed to. */
export function activeContactId(emp: WithContacts | null | undefined): string {
  const list = employerContacts(emp);
  if (!list.length) return '';
  const wanted = str(emp?.activeContactId);
  return list.some(c => c.id === wanted) ? wanted : list[0].id;
}

/** The contact everything is routed to, or null when the employer has no people yet. */
export function activeContact(emp: WithContacts | null | undefined): EmployerContact | null {
  const id = activeContactId(emp);
  return employerContacts(emp).find(c => c.id === id) || null;
}

/** A fresh id that no existing contact uses. Deterministic, so it is testable. */
export function nextContactId(list: EmployerContact[]): string {
  const taken = new Set(list.map(c => c.id));
  for (let n = 2; ; n++) {
    const id = `c${n}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * Write a list (and an active choice) onto an employer, mirroring the active contact
 * into the three legacy fields. Pure: returns a fresh employer.
 *
 * The mirror is the whole mechanism — see the note at the top of this file.
 */
export function applyContacts<T extends WithContacts>(emp: T, list: EmployerContact[], wantedActiveId?: string | null): T {
  const cleaned = (list || [])
    .map(c => ({ id: str(c.id), name: keep(c.name), role: keep(c.role), phone: keep(c.phone), email: keep(c.email), note: keep(c.note) }))
    .filter(c => !!c.id && !contactIsEmpty(c));
  const activeId = cleaned.some(c => c.id === str(wantedActiveId)) ? str(wantedActiveId) : (cleaned[0]?.id || '');
  const active = cleaned.find(c => c.id === activeId) || null;
  return {
    ...emp,
    contacts: cleaned,
    activeContactId: activeId || null,
    // THE MIRROR. Every existing reader of these three fields now follows the switch.
    // Trimmed here, and only here: these are the values that get dialled, mailed and
    // sent, so a stray space must never reach them — while the card above keeps what
    // is being typed into it, spaces and all.
    contactPerson: str(active?.name),
    contactPhone: str(active?.phone),
    contactEmail: str(active?.email),
  };
}

/**
 * Route everything to a different person. The one stepping aside keeps their card, so
 * handing it back when they return is the same call with their id.
 */
export function setActiveContact<T extends WithContacts>(emp: T, id: string): T {
  const list = employerContacts(emp);
  if (!list.some(c => c.id === str(id))) return emp; // unknown id changes nothing
  return applyContacts(emp, list, str(id));
}

/** Add a person, or update one already there. Does not change who is active. */
export function upsertContact<T extends WithContacts>(emp: T, contact: EmployerContact): T {
  const list = employerContacts(emp);
  const id = str(contact.id) || nextContactId(list);
  const next = list.some(c => c.id === id)
    ? list.map(c => (c.id === id ? { ...c, ...contact, id } : c))
    : [...list, { ...contact, id }];
  return applyContacts(emp, next, activeContactId(emp) || id);
}

/**
 * Remove a person. Removing the ACTIVE one hands everything to the first one left,
 * rather than leaving the employer with no route in.
 */
export function removeContact<T extends WithContacts>(emp: T, id: string): T {
  const list = employerContacts(emp);
  const next = list.filter(c => c.id !== str(id));
  if (next.length === list.length) return emp;
  const wasActive = activeContactId(emp) === str(id);
  return applyContacts(emp, next, wasActive ? (next[0]?.id ?? null) : activeContactId(emp));
}

/** "רונית לוי · מנהלת משאבי אנוש" — one line for a card header or a popover. */
export function contactLine(c: EmployerContact | null | undefined): string {
  if (!c) return '';
  return [str(c.name), str(c.role)].filter(Boolean).join(' · ');
}

/**
 * Tidy a list once, at save: every field trimmed, cards that hold nothing dropped.
 *
 * This is the other edge. While a card is being typed into, its fields are kept exactly
 * as typed (see `keep` above) — so the tidying that used to happen on every keystroke,
 * and ate the space bar, happens here instead, when the coordinator is done.
 */
export function normalizeContacts(list: EmployerContact[]): EmployerContact[] {
  return (list || [])
    .map(c => ({ id: str(c.id), name: str(c.name), role: str(c.role), phone: str(c.phone), email: str(c.email), note: str(c.note) }))
    .filter(c => !!c.id && !contactIsEmpty(c));
}
