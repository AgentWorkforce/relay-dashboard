import { useState } from "react";

/** A value with a copy button (API tokens, organization ids, Desktop links). */
export function CopyField(props: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="copy">
      <code>{props.value}</code>
      <button
        type="button"
        aria-label={`Copy ${props.label}`}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(props.value)
            .then(() => setCopied(true))
            .catch(() => undefined);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
