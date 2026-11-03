// Ported from hosted Cloud (app/components/ThemeToggle.tsx ThemeSelector):
// the Settings → Appearance choice of Match system, Light, or Dark.
import { useSyncExternalStore } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import {
  setThemePreference,
  subscribeTheme,
  themePreference,
  type ThemePreference,
} from "./theme";
import styles from "./theme-selector.module.css";

function ThemePreview({ mode }: { mode: ThemePreference }) {
  return (
    <span className={styles.preview} aria-hidden="true">
      {(mode === "system" ? ["light", "dark"] : [mode]).map((tone) => (
        <span key={tone} className={styles.previewPane} data-tone={tone}>
          <span className={styles.previewSidebar}>
            <span />
            <span />
            <span />
          </span>
          <span className={styles.previewContent}>
            <span />
            <span />
            <span />
          </span>
        </span>
      ))}
    </span>
  );
}

export function ThemeSelector() {
  const preference = useSyncExternalStore(
    subscribeTheme,
    themePreference,
    () => "dark" as const,
  );
  return (
    <section className={styles.section} aria-labelledby="theme-heading">
      <h2 id="theme-heading" className={styles.heading}>
        Theme
      </h2>
      <p className={styles.description}>
        Match system follows your device’s automatic light and dark schedule.
      </p>
      <fieldset className={styles.options} aria-label="Color theme">
        {(
          [
            { value: "system", label: "Match system", icon: Monitor },
            { value: "light", label: "Light", icon: Sun },
            { value: "dark", label: "Dark", icon: Moon },
          ] as const
        ).map(({ value, label, icon: Icon }) => (
          <label
            key={value}
            className={styles.option}
            data-state={preference === value ? "checked" : "unchecked"}
          >
            <input
              className={styles.radio}
              type="radio"
              name="color-theme"
              value={value}
              checked={preference === value}
              onChange={() => setThemePreference(value)}
            />
            <ThemePreview mode={value} />
            <span className={styles.label}>
              {preference === value ? (
                <span className={styles.check}>
                  <Check />
                </span>
              ) : (
                <Icon />
              )}
              {label}
            </span>
          </label>
        ))}
      </fieldset>
    </section>
  );
}
