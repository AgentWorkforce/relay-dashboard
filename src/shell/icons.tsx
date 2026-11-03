// Copied from hosted Cloud (sessions-icon.tsx, flows-icon.tsx).
import type { SVGProps } from "react";

/** Filled stack of terminal sessions, inheriting the navigation color. */
export function SessionsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 60" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M27 3h28a6 6 0 0 1 6 6v23a6 6 0 0 1-6 6h-3V17a8 8 0 0 0-8-8H21a6 6 0 0 1 6-6Z" />
      <path d="M18 12h26a5 5 0 0 1 5 5v24a5 5 0 0 1-5 5h-3V26a8 8 0 0 0-8-8H12a6 6 0 0 1 6-6Z" />
      <path
        fillRule="evenodd"
        d="M8 21h25a5 5 0 0 1 5 5v25a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V26a5 5 0 0 1 5-5Zm3.8 9.5a2 2 0 0 0-2.6 3l5.7 5-5.7 5a2 2 0 0 0 2.6 3l7.4-6.5a2 2 0 0 0 0-3l-7.4-6.5ZM23 44a2 2 0 0 0 0 4h7a2 2 0 0 0 0-4h-7Z"
      />
    </svg>
  );
}

/** Flows mark. Inherits the navigation text color. */
export function FlowsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none" aria-hidden="true" {...props}>
      <g fill="currentColor">
        <rect x="26" y="8" width="30" height="12" rx="3" />
        <rect x="8" y="22" width="12" height="18" rx="3" />
        <rect x="26" y="26" width="30" height="12" rx="3" />
        <rect x="8" y="46" width="12" height="12" rx="3" />
      </g>
    </svg>
  );
}
