import type { ComponentProps } from "react";
import { onLinkClick } from "../route";

export function AppLink({ onClick, ...props }: ComponentProps<"a">) {
  return <a {...props} onClick={(event) => { onClick?.(event); onLinkClick(event); }} />;
}
