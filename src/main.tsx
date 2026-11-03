import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app";
import { initTheme } from "./shell/theme";
import "./globals.css";
import "./brand.css";
import "./styles.css";

// Hosted Cloud sets the theme in an inline head script before hydration.
initTheme();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
