import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppCritters } from "./components/critters";
import "./styles.css";

// set the theme class before first paint (App keeps it in sync afterwards)
document.documentElement.classList.add(
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "t-dark" : "t-light",
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
    <AppCritters />
  </React.StrictMode>,
);

// dev only: poke at the store from devtools / browser previews
if (import.meta.env.DEV) {
  void import("./store").then(({ useApp }) => Object.assign(window, { __app: useApp }));
  // scripts/shot.mjs: open a file in the editing screen (the 편집 shot)
  void Promise.all([import("./engines/editing"), import("./engines/registry")]).then(([edit, reg]) =>
    Object.assign(window, {
      __openEdit: (projectId: string, taskId: string, path: string) => {
        const engine = reg.engineFor(path);
        if (engine) edit.useEngineEdit.getState().open({ projectId, taskId, path, engine });
      },
    }),
  );
}
