import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// set the theme class before first paint (App keeps it in sync afterwards)
document.documentElement.classList.add(
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "t-dark" : "t-light",
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// dev only: poke at the store from devtools / browser previews
if (import.meta.env.DEV) {
  void import("./store").then(({ useApp }) => Object.assign(window, { __app: useApp }));
}
