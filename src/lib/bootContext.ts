/**
 * Boot context – signals app_ready from deep in tree to clear boot timeout.
 */
import { createContext, useContext } from "react";

export type BootContextValue = { onAppReady: () => void } | null;

export const BootContext = createContext<BootContextValue>(null);

export function useBootContext(): BootContextValue {
  return useContext(BootContext);
}
