/// <reference types="vite/client" />
import type { Context } from "react";
import type { CareAuth } from "./types";
declare global {
  interface Window {
    CARE_API_URL: string;
    AuthUserContext?: Context<CareAuth | null>;
    __CORE_ENV__?: {
      disablePatientLogin?: boolean;
      mainLogo?: { light?: string; dark?: string };
    };
  }
}
export {};
