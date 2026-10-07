import type { ComponentType, ReactNode } from "react";
import AppointmentActions from "./AppointmentActions";
type Props = {
  __base: ComponentType<Record<string, unknown>>;
  children?: ReactNode;
  tagEntityType?: string;
  tagEntityId?: string;
  [key: string]: unknown;
};
export default function PatientInfoCard({
  __base: Base,
  children,
  ...props
}: Props) {
  return (
    <Base {...props}>
      {children}
      {props.tagEntityType === "appointment" &&
        typeof props.tagEntityId === "string" && (
          <AppointmentActions bookingId={props.tagEntityId} />
        )}
    </Base>
  );
}
