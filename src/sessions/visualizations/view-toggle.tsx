import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { Button } from "../../shell/ui";
import { cn } from "../../shell/cn";

const Context = createContext<{ value: string; change: (value: string) => void } | null>(null);

// Same single-selection ToggleGroup contract as the hosted session tabs.
export function ToggleGroup({ value, onValueChange, children, ...props }: {
  value: string; onValueChange: (value: string) => void; children: ReactNode;
} & ComponentProps<"div">) {
  return <Context value={{ value, change: onValueChange }}><div role="group" data-slot="toggle-group" className="flex flex-wrap gap-1" {...props}>{children}</div></Context>;
}
export function ToggleGroupItem({ value, className, onClick, ...props }: ComponentProps<"button"> & { value: string }) {
  const group = useContext(Context);
  return <Button {...props} variant="ghost" size="sm" data-slot="toggle-group-item" data-state={group?.value === value ? "on" : "off"} aria-pressed={group?.value === value} className={cn("data-[state=on]:bg-accent data-[state=on]:text-foreground", className)} onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) group?.change(value); }} />;
}
