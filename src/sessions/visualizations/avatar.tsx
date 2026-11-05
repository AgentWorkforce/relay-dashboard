// Plain-HTML counterpart of Cloud's Avatar, matching the dashboard's UI ports.
import { createContext, useContext, useState, type ComponentProps } from "react";
import { cn } from "../../shell/cn";

const AvatarContext = createContext<{ loaded: boolean; update: (loaded: boolean) => void } | null>(null);

export function Avatar({ className, children, ...props }: ComponentProps<"span">) {
  const [loaded, update] = useState(false);
  return <AvatarContext value={{ loaded, update }}><span data-slot="avatar" className={cn("relative flex size-8 shrink-0 overflow-hidden rounded-full", className)} {...props}>{children}</span></AvatarContext>;
}
export function AvatarImage({ onLoad, onError, className, style, ...props }: ComponentProps<"img">) {
  const state = useContext(AvatarContext);
  return <img {...props} data-slot="avatar-image" style={{ ...style, visibility: !state || state.loaded ? "visible" : "hidden" }} className={cn("absolute inset-0 size-full object-cover", className)} onLoad={(event) => { state?.update(true); onLoad?.(event); }} onError={(event) => { state?.update(false); onError?.(event); }} />;
}
export function AvatarFallback({ className, ...props }: ComponentProps<"span">) {
  const state = useContext(AvatarContext);
  return state?.loaded ? null : <span data-slot="avatar-fallback" className={cn("flex size-full items-center justify-center rounded-full bg-muted", className)} {...props} />;
}
