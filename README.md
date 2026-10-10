# CARE Zoom Video

Current implementation, setup and remaining work: [implementation handoff](../care/care_zoom/IMPLEMENTATION.md).

Independent frontend plugin for `care_zoom`, using the pinned CARE frontend's existing component override and authentication APIs. No core source edits are required.

Staff calls use `/facility/<facility_uuid>/patient/<patient_uuid>/appointments/<booking_uuid>/video`, inside CARE’s facility shell. The stable shared `/teleconsult/<booking_uuid>` URL stays available to patients authenticated with CARE OTP and redirects signed-in staff to that facility route. Deploy the matching `care_zoom` backend update, which returns authorized staff-only `staff_context` IDs for this redirect. For eligible video appointments, **Join Video Call** appears beside the native Check-In/action group for the assigned practitioner; staff with booking-read permission may copy the link. In-person appointments have no Zoom actions. The patient portal retains its compact Video appointments panel, filtered by backend eligibility. Core controls, tabs, props and children are retained.

In Schedule Management, **Consultation mode** beside the native **Edit** action selects **In person** (default) or **Video call** for the whole practitioner schedule. Saving updates `Schedule.meta["care_zoom"]["video_enabled"]` through the plugin API and applies to every existing and future booking under that schedule. Existing schedules need explicit opt-in. There are no time-block overrides or booking snapshots; use separate schedules for different modes. This setting contains no meeting credentials and requires zero tracked core changes.

The staff call page shows the appointment’s notes, patient, facility, time and status. **Open encounter** opens its associated encounter; **Start consultation** opens CARE’s native appointment-linked encounter form when the appointment is eligible. Other non-final appointments link to the native appointment page for planned encounter creation. These actions open a new tab to keep the call connected, and returning refreshes the encounter association. Permissions and encounter creation remain with CARE.

The Video SDK loads only after the user chooses **Prepare for call**. Camera preview, microphone level check and device selection precede joining. In a call the controls include audio, mute, camera, Leave and assigned-host End for everyone. Speaker selection appears only where supported; mobile camera selection uses front/back facing modes. Zoom tokens remain in function memory and are fetched afresh for each join.

Connected calls offer native **Picture-in-picture** on browsers with the Document Picture-in-Picture API (secure context required). The floating window retains the live video, audio/camera controls and Leave action. Chrome can open it on tab switches through Media Session when the page uses HTTPS, camera/microphone capture is active, and the user’s Auto PiP setting permits it. HTTP localhost passes the secure-context check for manual PiP, but Chromium explicitly excludes HTTP URLs from automatic PiP. Use the manual button on the local HTTP workspace; automatic behavior needs a trusted HTTPS deployment. See [Chromium’s URL eligibility check](https://github.com/chromium/chromium/blob/main/chrome/browser/picture_in_picture/auto_picture_in_picture_tab_helper.cc). Closing the floating window restores the call to its tab; leaving or unmounting closes it. Unsupported browsers keep the call in its original tab. See [Chrome’s automatic PiP requirements](https://developer.chrome.com/blog/automatic-picture-in-picture) and [Document PiP](https://developer.chrome.com/docs/web-platform/document-picture-in-picture). Navigating the call tab itself still leaves the call.

Joining or leaving does not update appointment status. The backend authorizes every token request, including schedule opt-in for direct links. Changing schedule mode or appointment eligibility does not revoke a token already issued or disconnect a running call. Logging out, changing authenticated identity or leaving the page disposes the SDK/media resources. Recording, transcripts, screen sharing, chat, waiting rooms, reminders, webhooks and native applications are outside v1.

## Local startup

This checkout uses Node 24 and npm. The isolated scaffold runtime is `/Users/gigin/care_scaffold`; saved ports are API **25416**, frontend host **25417**, plugin preview **25418**.

```sh
cd /Users/gigin/care_scaffold/care_zoom_fe
npm ci
npm run start
```

`npm run start` runs `vite build` in watch mode (via nodemon) alongside `vite preview`, rebuilding and re-serving the remote on every source change. If running only the built artifact, use `npm run build` followed by `npm run preview`. Hard reload the host after a plugin rebuild.

In other terminals, start only this workspace's services:

```sh
/Users/gigin/care_scaffold/.agent/compose.sh up -d --wait
/Users/gigin/care_scaffold/.agent/frontend.sh
```

The external `/Users/gigin/care_scaffold/.agent/frontend.env` must include the following entries, merged with any existing values:

```dotenv
REACT_ENABLED_APPS=ohcnetwork/care_zoom_fe@localhost:25418/assets/remoteEntry.js
REACT_MFE_REGISTERED_COMPONENTS=PatientInfoCard,PatientPortalIndex,PublicRouter,EditScheduleTemplateSheet
```

The launcher supplies `REACT_CARE_API_URL` and the host's strict port from `care-scaffold.env`. Do not edit core `.env`, routes or source. Restart the host after changing the override allowlist; rebuilding the remote alone cannot register a new host component. Build-time plugin registration makes the call URL work before login. Configure Zoom Video SDK credentials only in the backend's external settings; no SDK secret belongs in this frontend.

Deployment requires HTTPS (localhost is supported for development), browser media access and network access to the Zoom SDK/media services. Verify the deployment's CSP permits the SDK assets/workers required by Zoom. The remote and host must use compatible shared React versions.

## Verification

```sh
cd /Users/gigin/care_scaffold/care_zoom_fe
npm test
npm run typecheck
npm run build
# Against the running isolated host; uses API fixtures, never modifies the database:
CARE_FE_URL=http://localhost:25417 PLAYWRIGHT_CHANNEL=chrome npm run test:host
```

The browser suite uses installed Chrome when `PLAYWRIGHT_CHANNEL=chrome`; otherwise install the version of Chromium required by Playwright with `npx playwright install chromium`.

- `tests/entrypoints.test.tsx`: wrapper preservation, exact public route matching, encoded absolute same-origin staff login return, CARE's five-digit OTP flow, token/auth scoping, pagination safety, session renewal and changed-identity isolation. Active calls remain mounted when metadata eligibility changes.
- `tests/schedule-video.test.tsx`: consultation-mode read/save, native Edit preservation and settings failures.
- `tests/staff-appointment-details.test.tsx`: staff-only reads, permissions, empty encounter responses, native encounter links, route validation and focus refresh.
- `tests/zoom-call.test.tsx`: native PiP lifecycle/portal controls with browser API mocks, mocked SDK lifecycle, media errors, device changes, reconnect, remote participant rendering, host ending and cleanup. These tests do not establish real media interoperability.
- `tests/host.spec.ts`: real pinned host and federated plugin with clearly marked API fixtures. Verifies staff login return, OTP route fallback, preserved appointment card and patient portal controls, unrelated public routes, and real lazy SDK prejoin with browser-denied camera access without requesting a Zoom token.

The opt-in real-backend regression in `tests/host-live.spec.ts` verifies the actual seeded doctor appointment, adjacent native/Zoom actions, its patient popover, facility call redirect, appointment details, native encounter form opening in a separate tab, and Schedule Management. It switches only the synthetic schedule to in person, checks that existing appointment Zoom actions disappear, and restores the original flag in `finally`. It also checks the appointment and settings at desktop and mobile widths. It does not mock API responses, reset the database, change appointment status, or join a Zoom call. Run the explicit local fixture first (requires the existing core `care-doctor` fixture user):

```sh
/Users/gigin/care_scaffold/.agent/compose.sh exec backend python manage.py shell -c 'from care_zoom.tests.seed_local import seed; seed()'
CARE_FE_URL=http://localhost:25417 PLAYWRIGHT_CHANNEL=chrome npm run test:host:live
```

The seed explicitly enables video on its synthetic Zoom schedule only; it never bulk-enables ordinary schedules. The test signs in as `care-doctor` with the core development password; set `CARE_TEST_PASSWORD` if that local password was changed. Browser traces are disabled for this mode so authentication is not saved in trace artifacts. The usual `test:host` command continues to run only the mocked suite.

The entry-point and login flows were verified with a placeholder before the SDK was integrated. Real two-party Zoom media and automatic tab-switch PiP remain acceptance checks; mocked SDK tests do not establish them. Acceptance still requires separate doctor/patient browser sessions, real audio/video, reconnect, host ending, Android Chrome and iOS Safari.

## Integration details

`src/manifest.tsx` is the sole federation export. `PatientInfoCard`, `PatientPortalIndex` and `EditScheduleTemplateSheet` wrap injected `__base`; `PublicRouter` matches only the UUID call URL and otherwise preserves its base. `PatientInfoCard` groups the original native action children with plugin actions, without replacing Check-In's handlers. `EditScheduleTemplateSheet` preserves native Edit and adds the plugin settings dialog alongside it. Staff uses `manifest.routes`; patient routes use the core `PatientRouter` fallback to `PublicRouter`.

`window.AuthUserContext` supplies reactive staff/patient identity and `patientLogin`; bearer requests read only the corresponding current CARE storage key. Patient authentication calls existing `/api/v1/otp/send/` and `/api/v1/otp/login/`. The portal reads `/api/v1/otp/slots/get_appointments/`, retains in-progress appointments, follows same-origin pagination and checks plugin eligibility. Staff expiry may use HTTP 403 with `token_not_valid` on this core pin; only that known code is retained for login recovery.

Plugin API metadata and tokens are fetched from `/api/care_zoom/{otp/}appointments/<uuid>/` and `.../token/`. The server derives identities, roles and session names. UI code sends no role, patient identity or session overrides.

Schedule consultation mode uses staff-authenticated GET/PATCH `/api/care_zoom/facility/<facility_uuid>/schedules/<schedule_uuid>/video/`, returning `schedule_id` and `video_enabled`. PATCH sends only `{ "video_enabled": true }` or `{ "video_enabled": false }`; the backend applies CARE's schedule read/write permissions and rejects in-person appointment token requests for both staff and patients.

All plugin styles are scoped below `.care-zoom-container`; the plugin does not ship global preflight. Translation keys use `zoom__` in `public/locale/en.json`. The roughly 1 MB Zoom SDK JavaScript bundle is a separate lazy chunk, absent from the initial manifest payload.

Pinned-host differences from older scaffold examples are tracked in [care_scaffold issue #5](https://github.com/ohcnetwork/care_scaffold/issues/5). This repository remains independent of the scaffold and both independent core checkouts.
