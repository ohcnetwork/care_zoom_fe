import { lazy, Suspense } from "react";
import { teleconsultMatch } from "./utils/routes";
const CallPage = lazy(() => import("./pages/CallPage"));
const manifest = {
  plugin: "care_zoom_fe",
  routes: {
    "/teleconsult/:bookingId": ({ bookingId }: { bookingId: string }) => (
      <Suspense fallback={null}>
        <CallPage key={bookingId} bookingId={bookingId} />
      </Suspense>
    ),
  },
  extends: [],
  components: {},
  navItems: [],
  userNavItems: [],
  adminNavItems: [],
  overrides: [
    {
      component: "PatientInfoCard",
      replacement: lazy(() => import("./components/PatientInfoCard")),
      priority: 10,
    },
    {
      component: "PatientPortalIndex",
      replacement: lazy(() => import("./components/PatientPortalIndex")),
      priority: 10,
    },
    {
      component: "PublicRouter",
      replacement: lazy(() => import("./components/PublicRouter")),
      priority: 10,
      condition: {
        custom: (context: { route?: string }) =>
          !!teleconsultMatch(context.route ?? ""),
      },
    },
  ],
};
export default manifest;
