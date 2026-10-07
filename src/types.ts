export type AuthKind = "staff" | "patient";
export interface PatientToken {
  token: string;
  phoneNumber: string;
  createdAt: string;
}
export interface CareAuth {
  user?: { id: string; is_superuser?: boolean };
  patientToken: PatientToken | null;
  patientLogin: (token: PatientToken, returnPath: string) => void;
  signOut: () => Promise<void>;
}
export interface AppointmentInfo {
  booking_id: string;
  status: string;
  patient_name: string;
  practitioner_name: string;
  start_datetime: string;
  end_datetime: string;
  join_opens_at: string;
  join_closes_at: string;
  join_path: string;
  eligible: boolean;
  can_join: boolean;
  caller_role: "host" | "participant" | "observer";
  reason: string | null;
  configured: boolean;
  staff_context?: { facility_id: string; patient_id: string };
}
/** Narrow mirrors of staff-only core responses; never requested with an OTP token. */
export interface StaffFacility {
  id: string;
  name: string;
  permissions: string[];
}
export interface StaffAppointment {
  id: string;
  status: string;
  note: string;
  facility: { id: string; name: string };
  patient: { id: string; name: string };
  token_slot: { start_datetime: string; end_datetime: string };
  associated_encounter?: { id?: string } | null;
}
export interface JoinToken {
  token: string;
  session_name: string;
  session_key: string;
  display_name: string;
  role: "host" | "participant";
  expires_at: string;
}
export interface PublicAppointment {
  id: string;
  status: string;
  resource_type: string;
  token_slot: { start_datetime: string; end_datetime: string };
}
