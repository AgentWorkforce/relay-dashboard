// Hosted Cloud's theme handling (app/layout.tsx themeScript and
// components/ThemeToggle.tsx): `agentrelay-theme` in localStorage holds
// "dark" (default), "light" or "system"; html[data-theme] carries the result.
export type Theme = "dark" | "light";
export type ThemePreference = Theme | "system";

const KEY = "agentrelay-theme";
const listeners = new Set<() => void>();

function systemTheme(): Theme {
  if (typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function storedPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === "light" || stored === "system" ? stored : "dark";
  } catch {
    return "dark";
  }
}

function apply(preference: ThemePreference) {
  const theme = preference === "system" ? systemTheme() : preference;
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  for (const listener of listeners) listener();
}

/** Run once before the first render (hosted runs this as an inline script). */
export function initTheme() {
  apply(storedPreference());
  if (typeof window.matchMedia !== "function") return;
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener?.("change", () => {
      if (document.documentElement.dataset.themePreference === "system")
        apply("system");
    });
}

export function setThemePreference(preference: ThemePreference) {
  const root = document.documentElement;
  root.classList.add("theme-transitioning");
  try {
    window.localStorage.setItem(KEY, preference);
  } catch {
    /* The choice still applies to this page. */
  }
  apply(preference);
  window.setTimeout(() => root.classList.remove("theme-transitioning"), 300);
}

export function subscribeTheme(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function themePreference(): ThemePreference {
  const value = document.documentElement.dataset.themePreference;
  return value === "light" || value === "system" ? value : "dark";
}
