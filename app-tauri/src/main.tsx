import React from "react";
import ReactDOM from "react-dom/client";
// Fonts are bundled rather than fetched: this is a desktop app that has to
// look the same with no network, and a CDN request would also be the only
// call the UI makes to anyone. Only the weights actually used are imported.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
