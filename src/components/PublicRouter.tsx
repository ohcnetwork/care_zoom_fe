import type { ComponentType } from "react";
import CallPage from "../pages/CallPage";
import { teleconsultMatch } from "../utils/routes";
export default function PublicRouter({
  __base: Base,
  ...props
}: {
  __base: ComponentType<Record<string, unknown>>;
  [key: string]: unknown;
}) {
  const match = teleconsultMatch(window.location.pathname);
  return match ? (
    <CallPage key={match[1]} bookingId={match[1]} />
  ) : (
    <Base {...props} />
  );
}
