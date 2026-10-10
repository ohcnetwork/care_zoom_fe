import { useState } from "react";
import type { GuestSession } from "../types";

const storageKey = (bookingId: string) => `zoom_guest_session:${bookingId}`;

function readOrCreate(bookingId: string): GuestSession {
  try {
    const raw = sessionStorage.getItem(storageKey(bookingId));
    if (raw) return JSON.parse(raw) as GuestSession;
  } catch {
    // fall through to creating a fresh session
  }
  const id = crypto.randomUUID();
  const session: GuestSession = {
    id,
    name: `Guest ${id.slice(0, 4).toUpperCase()}`,
    createdAt: new Date().toISOString(),
  };
  try {
    sessionStorage.setItem(storageKey(bookingId), JSON.stringify(session));
  } catch {
    // sessionStorage unavailable (e.g. private mode); identity just won't persist across reloads
  }
  return session;
}

/** Per-tab, unauthenticated identity for the public teleconsult link; created automatically, no gate. */
export function useGuestSession(bookingId: string) {
  const [session] = useState<GuestSession>(() => readOrCreate(bookingId));
  return { session };
}
