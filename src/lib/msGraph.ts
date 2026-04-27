// Microsoft Graph — Outlook Calendar integration (stub + MSAL placeholders)
// Full MSAL auth is optional; when not signed in, all functions are no-ops.

export type EventInput = {
  subject: string;
  startDate: string;       // YYYY-MM-DD
  startTime?: string;      // HH:MM
  endTime?: string;        // HH:MM
  location?: string;
  body?: string;
  attendeeEmails?: string[];
};

export type GraphEvent = { id: string };

/** Returns true if the user has an active Microsoft Graph session. */
export async function isSignedIn(): Promise<boolean> {
  return false;  // MSAL integration not yet wired — always false until configured
}

/** Create a calendar event via Microsoft Graph. Returns null when not signed in. */
export async function createEvent(_input: EventInput): Promise<GraphEvent | null> {
  if (!(await isSignedIn())) return null;
  return null;
}

/** Update an existing calendar event. No-op when not signed in. */
export async function updateEvent(_id: string, _input: EventInput): Promise<void> {
  // no-op
}

/** Delete a calendar event. No-op when not signed in. */
export async function deleteEvent(_id: string): Promise<void> {
  // no-op
}

// ── SettingsPage stubs (MSAL config not yet wired) ─────────────────────────
export type MsConfig = { clientId: string; tenantId: string };

export function hasConfig(): boolean { return false; }
export function getConfig(): MsConfig | null { return null; }
export function setConfig(_cfg: MsConfig): void { /* no-op */ }
export function clearConfig(): void { /* no-op */ }
export async function signIn(): Promise<void> { /* no-op */ }
export async function signOut(): Promise<void> { /* no-op */ }
export async function signedInEmail(): Promise<string | null> { return null; }
