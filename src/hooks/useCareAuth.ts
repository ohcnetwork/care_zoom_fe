import { createContext, useContext } from "react";
import type { CareAuth } from "../types";
const StandaloneContext = createContext<CareAuth | null>(null);
export function useCareAuth() {
  return useContext(window.AuthUserContext ?? StandaloneContext);
}
export function authKind(auth: CareAuth | null) {
  return auth?.user
    ? ("staff" as const)
    : auth?.patientToken?.token
      ? ("patient" as const)
      : null;
}
