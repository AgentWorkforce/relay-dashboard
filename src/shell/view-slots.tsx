// Copied from hosted Cloud (workspace-view-slots.tsx): pages portal their
// heading, toolbar and sidebar controls into the shell while keeping state.
import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

type WorkspaceViewSlotName = "sidebar" | "sidebarFooter" | "toolbar" | "heading";

export type WorkspaceViewSlots = {
  sidebar: HTMLElement | null;
  sidebarFooter: HTMLElement | null;
  closeSidebar?: () => void;
  restoreSidebarFocus?: () => boolean;
  toolbar: HTMLElement | null;
  heading: HTMLElement | null;
};

export const WorkspaceViewSlotsContext =
  createContext<WorkspaceViewSlots | null>(null);

export function useWorkspaceViewSlots() {
  return useContext(WorkspaceViewSlotsContext);
}

/** Keep each page's controls in one place without transferring their state to the shell. */
export function WorkspaceViewSlot({
  name,
  children,
}: {
  name: WorkspaceViewSlotName;
  children: ReactNode;
}) {
  const slots = useWorkspaceViewSlots();
  if (!slots) return children;
  return slots[name] ? createPortal(children, slots[name]) : null;
}
