import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import App from "./App";
import { AuthProvider } from "./lib/auth";
import { ShopProvider } from "./lib/shop";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <AuthProvider>
    <ShopProvider>
      <App />
      <Toaster
        position="top-center"
        dir="rtl"
        theme="dark"
        richColors
        toastOptions={{ style: { fontFamily: "Tajawal, sans-serif" } }}
      />
    </ShopProvider>
  </AuthProvider>,
);
