import { createRoot } from "react-dom/client";
import Page from "./components/Page";
window.CARE_API_URL ??= "http://localhost:25416";
createRoot(document.getElementById("root")!).render(
  <Page>
    <main className="m-6 rounded-lg border bg-white p-6">
      <h1 className="text-xl font-bold">CARE Zoom Video</h1>
      <p className="mt-2">
        Open a video appointment from CARE to join. This preview serves the
        plugin remote.
      </p>
    </main>
  </Page>,
);
