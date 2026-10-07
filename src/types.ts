export type AuthKind = "staff" | "patient";
export interface PatientToken {
  token: string;
  phoneNumber: string;
  createdAt: string;
}
export interface CareAuth {
  user?: { id: string };
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
