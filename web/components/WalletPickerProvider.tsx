"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { WalletPicker } from "./WalletPicker";

const OpenPicker = createContext<() => void>(() => {});

/** One wallet picker for the whole app, so any "connect" prompt opens the same dialog. */
export function WalletPickerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  return (
    <OpenPicker.Provider value={show}>
      {children}
      <WalletPicker open={open} onClose={hide} />
    </OpenPicker.Provider>
  );
}

export const useOpenWalletPicker = () => useContext(OpenPicker);
