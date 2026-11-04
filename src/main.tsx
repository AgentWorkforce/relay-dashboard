// Stylesheets first: globals.css declares the cascade layer order
// (theme, base, legacy, components, utilities), and the first stylesheet in
// the bundle fixes it. Page stylesheets imported by ./app use `legacy`.
import "./globals.css";
import "./brand.css";
import "./styles.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app";
import { initTheme } from "./shell/theme";

// Hosted Cloud sets the theme in an inline head script before hydration.
initTheme();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
