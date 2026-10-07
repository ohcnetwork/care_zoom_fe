# CARE Zoom Video

Independent frontend plugin for `care_zoom`, using the pinned CARE frontend's existing component override and authentication APIs. No core source edits are required.

A stable `/teleconsult/<booking_uuid>` URL serves the assigned practitioner and the patient authenticated with CARE OTP. The plugin adds Join/Copy actions to staff appointment details and a compact Video appointments panel above the existing patient portal. Core controls, tabs, props and children are retained.

The Video SDK loads only after the user chooses **Prepare for call**. Camera preview, microphone level check and device selection precede joining. In a call the controls include audio, mute, camera, Leave and assigned-host End for everyone. Speaker selection appears only where supported; mobile camera selection uses front/back facing modes. Zoom tokens remain in function memory and are fetched afresh for each join.

Joining or leaving does not update appointment status. The backend authorizes every token request. Changes to appointment eligibility do not revoke a token already issued or disconnect a running call. Logging out, changing authenticated identity or leaving the page disposes the SDK/media resources. Recording, transcripts, screen sharing, chat, waiting rooms, reminders, webhooks and native applications are outside v1.

## Local startup

This checkout uses Node 24 and npm. The isolated scaffold runtime is `/Users/gigin/care_scaffold`; saved ports are API **25416**, frontend host **25417**, plugin preview **25418**.

```sh
cd /Users/gigin/care_zoom_fe
npm ci
npm run dev
```

`npm run dev` builds, serves the remote on `127.0.0.1:25418`, then watches the plugin sources. It fails if the saved port is occupied. If running only the built artifact, use `npm run build` followed by `npm run preview`. Hard reload the host after a plugin rebuild.

In other terminals, start only this workspace's services:

```sh
/Users/gigin/care_scaffold/.agent/compose.sh up -d --wait
/Users/gigin/care_scaffold/.agent/frontend.sh
```

The external `/Users/gigin/care_scaffold/.agent/frontend.env` must include the following entries, merged with any existing values:

```dotenv
REACT_ENABLED_APPS=ohcnetwork/care_zoom_fe@localhost:25418/assets/remoteEntry.js
REACT_MFE_REGISTERED_COMPONENTS=PatientInfoCard,PatientPortalIndex,PublicRouter
```

The launcher supplies `REACT_CARE_API_URL` and the host's strict port from `care-scaffold.env`. Do not edit core `.env`, routes or source. Build-time plugin registration makes the call URL work before login. Configure Zoom Video SDK credentials only in the backend's external settings; no SDK secret belongs in this frontend.

Deployment requires HTTPS (localhost is supported for development), browser media access and network access to the Zoom SDK/media services. Verify the deployment's CSP permits the SDK assets/workers required by Zoom. The remote and host must use compatible shared React versions.

## Verification

```sh
cd /Users/gigin/care_zoom_fe
npm test
npm run typecheck
npm run build
# Against the running isolated host; uses API fixtures, never modifies the database:
CARE_FE_URL=http://localhost:25417 PLAYWRIGHT_CHANNEL=chrome npm run test:host
```

The browser suite uses installed Chrome when `PLAYWRIGHT_CHANNEL=chrome`; otherwise install the version of Chromium required by Playwright with `npx playwright install chromium`.

- `tests/entrypoints.test.tsx`: wrapper preservation, exact public route matching, encoded absolute same-origin staff login return, CARE's five-digit OTP flow, token/auth scoping, pagination safety, session renewal and changed-identity isolation. Active calls remain mounted when metadata eligibility changes.
- `tests/zoom-call.test.tsx`: mocked SDK lifecycle, media errors, device changes, reconnect, remote participant rendering, host ending and cleanup. These tests do not establish real media interoperability.
- `tests/host.spec.ts`: real pinned host and federated plugin with clearly marked API fixtures. Verifies staff login return, OTP route fallback, preserved appointment card and patient portal controls, unrelated public routes, and real lazy SDK prejoin with browser-denied camera access without requesting a Zoom token.

The entry-point and login flows were verified with a placeholder before the SDK was integrated. A real two-party Zoom call is still unverified without Video SDK credentials. Acceptance still requires separate doctor/patient browser sessions, real audio/video, reconnect, host ending, Android Chrome and iOS Safari.

## Integration details

`src/manifest.tsx` is the sole federation export. `PatientInfoCard` and `PatientPortalIndex` wrap injected `__base`; `PublicRouter` matches only the UUID call URL and otherwise preserves its base. Staff uses `manifest.routes`; patient routes use the core `PatientRouter` fallback to `PublicRouter`.

`window.AuthUserContext` supplies reactive staff/patient identity and `patientLogin`; bearer requests read only the corresponding current CARE storage key. Patient authentication calls existing `/api/v1/otp/send/` and `/api/v1/otp/login/`. The portal reads `/api/v1/otp/slots/get_appointments/`, retains in-progress appointments, follows same-origin pagination and checks plugin eligibility. Staff expiry may use HTTP 403 with `token_not_valid` on this core pin; only that known code is retained for login recovery.

Plugin API metadata and tokens are fetched from `/api/care_zoom/{otp/}appointments/<uuid>/` and `.../token/`. The server derives identities, roles and session names. UI code sends no role, patient identity or session overrides.

All plugin styles are scoped below `.care-zoom-container`; the plugin does not ship global preflight. Translation keys use `zoom__` in `public/locale/en.json`. The roughly 1 MB Zoom SDK JavaScript bundle is a separate lazy chunk, absent from the initial manifest payload.

Pinned-host differences from older scaffold examples are tracked in [care_scaffold issue #5](https://github.com/ohcnetwork/care_scaffold/issues/5). This repository remains independent of the scaffold and both core submodules.
