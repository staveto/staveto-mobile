import React, { createContext, useCallback, useContext, useRef, useState } from "react";

type QuickNoteContextType = {
  registerOpenQuickNote: (fn: () => void) => () => void;
  triggerOpenQuickNote: () => void;
};

const QuickNoteContext = createContext<QuickNoteContextType | null>(null);

export function QuickNoteProvider({ children }: { children: React.ReactNode }) {
  const openRef = useRef<(() => void) | null>(null);

  const registerOpenQuickNote = useCallback((fn: () => void) => {
    openRef.current = fn;
    return () => {
      openRef.current = null;
    };
  }, []);

  const triggerOpenQuickNote = useCallback(() => {
    openRef.current?.();
  }, []);

  return (
    <QuickNoteContext.Provider value={{ registerOpenQuickNote, triggerOpenQuickNote }}>
      {children}
    </QuickNoteContext.Provider>
  );
}

export function useQuickNoteContext(): QuickNoteContextType | null {
  return useContext(QuickNoteContext);
}
