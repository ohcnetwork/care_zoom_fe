export const teleconsultMatch = (path: string) =>
  /^\/teleconsult\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(
    path,
  );
export const callPath = (id: string) => `/teleconsult/${id}`;
export const staffCallPath = (
  bookingId: string,
  facilityId: string,
  patientId: string,
) =>
  `/facility/${encodeURIComponent(facilityId)}/patient/${encodeURIComponent(patientId)}/appointments/${encodeURIComponent(bookingId)}/video`;
export const callUrl = (id: string) =>
  new URL(callPath(id), window.location.origin).href;
export const staffLoginUrl = (id: string) =>
  `/login?redirect=${encodeURIComponent(callUrl(id))}`;
