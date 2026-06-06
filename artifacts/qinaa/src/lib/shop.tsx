import { createContext, useContext, useState, type ReactNode } from "react";
import { ShopModal } from "../components/ShopModal";

type ShopContextValue = {
  open: boolean;
  openShop: () => void;
  closeShop: () => void;
};

const ShopContext = createContext<ShopContextValue | null>(null);

export function useShop(): ShopContextValue {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error("useShop must be used within <ShopProvider>");
  return ctx;
}

/**
 * Renders the ShopModal at the app root so it can be triggered from any
 * screen (footer, entitlement gatekeeper) regardless of the active mode.
 */
export function ShopProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openShop = () => setOpen(true);
  const closeShop = () => setOpen(false);

  return (
    <ShopContext.Provider value={{ open, openShop, closeShop }}>
      {children}
      <ShopModal open={open} onClose={closeShop} />
    </ShopContext.Provider>
  );
}
