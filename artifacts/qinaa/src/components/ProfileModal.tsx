import { useEffect, useState } from "react";
import { X, LogOut, Loader2, ChevronLeft } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { useAuth } from "../lib/auth";
import type { Entitlements } from "../lib/supabase";
import { FREE_GAME_LIMIT } from "../lib/supabase";

function formatJoinDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

function PackageBadge({
  entitlements,
  entitlementsLoading,
  freeRemaining,
}: {
  entitlements: Entitlements | null;
  entitlementsLoading: boolean;
  freeRemaining: number;
}) {
  if (entitlementsLoading || !entitlements) {
    return (
      <span className="text-[11px]" style={{ color: "#555555" }}>
        جارٍ التحقق…
      </span>
    );
  }

  if (entitlements.has_all_access) {
    return (
      <span
        className="inline-flex w-fit items-center gap-1 text-xs font-black px-2.5 py-1 rounded-md"
        style={{
          backgroundColor: "#1A1206",
          color: "#FBBF24",
          border: "1px solid rgba(245,158,11,0.4)",
        }}>
        الباقة الشاملة 👑
      </span>
    );
  }

  if (entitlements.has_base_game) {
    return (
      <span
        className="inline-flex w-fit items-center text-xs font-black px-2.5 py-1 rounded-md"
        style={{
          backgroundColor: "#161616",
          color: "#DDDDDD",
          border: "1px solid #333333",
        }}>
        اللعبة الأساسية
      </span>
    );
  }

  return (
    <span
      className="inline-flex w-fit items-center text-xs font-black px-2.5 py-1 rounded-md"
      style={{
        backgroundColor: "#120808",
        color: "#EF9A9A",
        border: "1px solid rgba(211,47,47,0.3)",
      }}>
      التجربة المجانية (المتبقي: {freeRemaining})
    </span>
  );
}

export function ProfileModal({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  user: User;
}) {
  const { entitlements, entitlementsLoading, signOut, deleteAccount } = useAuth();
  const freeRemaining = Math.max(0, FREE_GAME_LIMIT - (entitlements?.games_played ?? 0));

  const [view, setView] = useState<"profile" | "confirmDelete">("profile");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setView("profile");
      setDeleting(false);
      setDeleteError(null);
    }
  }, [open]);

  if (!open) return null;

  const handleDelete = async () => {
    setDeleteError(null);
    setDeleting(true);
    const { error } = await deleteAccount();
    setDeleting(false);
    if (error) {
      setDeleteError("تعذّر حذف الحساب. حاول مرة أخرى أو تواصل مع الدعم.");
      return;
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ backgroundColor: "rgba(0,0,0,0.88)", backdropFilter: "blur(12px)" }}
      onClick={onClose}>
      <div
        dir="rtl"
        className="fixed top-0 inset-x-0 z-[60] flex items-center justify-between px-4 md:px-8 lg:px-12 py-4 pointer-events-none">
        <button
          onClick={onClose}
          title="إغلاق"
          aria-label="إغلاق الملف الشخصي"
          className="pointer-events-auto flex items-center justify-center w-10 h-10 rounded-full text-white/70 hover:text-white transition-colors active:scale-90"
          style={{
            backgroundColor: "rgba(13,13,13,0.55)",
            border: "1px solid rgba(255,255,255,0.06)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
          }}>
          <X size={18} strokeWidth={2} />
        </button>
      </div>

      <div
        dir="rtl"
        className="w-full max-w-md rounded-2xl p-6 flex flex-col gap-5 shadow-2xl"
        style={{ backgroundColor: "#111111", border: "1px solid rgba(255,255,255,0.08)" }}
        onClick={(e) => e.stopPropagation()}>
        {view === "profile" ? (
          <>
            <div className="flex flex-col gap-1">
              <h2 className="font-black text-lg text-white">الملف الشخصي</h2>
              <p className="text-xs" style={{ color: "#555555" }}>
                تفاصيل حسابك وباقتك الحالية
              </p>
            </div>

            <div style={{ height: "1px", backgroundColor: "rgba(255,255,255,0.06)" }} />

            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold" style={{ color: "#666666" }}>
                  البريد الإلكتروني
                </span>
                <span dir="ltr" className="text-sm font-bold text-right" style={{ color: "#E0E0E0" }}>
                  {user.email ?? "—"}
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold" style={{ color: "#666666" }}>
                  تاريخ الإنشاء
                </span>
                <span className="text-sm font-bold" style={{ color: "#E0E0E0" }}>
                  {formatJoinDate(user.created_at)}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold" style={{ color: "#666666" }}>
                  الباقة
                </span>
                <PackageBadge
                  entitlements={entitlements}
                  entitlementsLoading={entitlementsLoading}
                  freeRemaining={freeRemaining}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => { void signOut().then(onClose); }}
                className="flex flex-row-reverse items-center justify-center gap-2 w-full px-4 py-3 rounded-xl border text-sm font-semibold transition-all duration-200 active:scale-95"
                style={{ backgroundColor: "#0D0000", borderColor: "#4A0000", color: "#9E4444" }}>
                <LogOut size={16} />
                <span>تسجيل الخروج</span>
              </button>

              <button
                onClick={() => setView("confirmDelete")}
                className="w-full px-4 py-2.5 rounded-xl text-xs font-bold transition-colors active:scale-95"
                style={{ color: "#EF4444", border: "1px solid rgba(239,68,68,0.25)" }}>
                حذف الحساب
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              onClick={() => { setView("profile"); setDeleteError(null); }}
              disabled={deleting}
              className="flex items-center gap-1 text-xs self-start transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ color: "#888888" }}>
              <ChevronLeft size={14} className="rotate-180" />
              <span>رجوع</span>
            </button>

            <div className="flex flex-col gap-2">
              <h2 className="font-black text-lg text-white">تأكيد حذف الحساب</h2>
              <p className="text-sm leading-relaxed" style={{ color: "#AAAAAA" }}>
                هل أنت متأكد من رغبتك في حذف حسابك؟ سيتم مسح جميع بياناتك ومشترياتك ولن تتمكن من
                استرجاعها.
              </p>
            </div>

            {deleteError && (
              <p className="text-xs font-semibold text-center" style={{ color: "#EF9A9A" }}>
                {deleteError}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={() => { setView("profile"); setDeleteError(null); }}
                disabled={deleting}
                className="w-full px-4 py-3 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-50"
                style={{ backgroundColor: "#1A1A1A", color: "#CCCCCC", border: "1px solid #333333" }}>
                إلغاء
              </button>
              <button
                onClick={() => { void handleDelete(); }}
                disabled={deleting}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-50"
                style={{ backgroundColor: "#2A0A0A", color: "#FF6B6B", border: "1px solid rgba(239,68,68,0.45)" }}>
                {deleting ? <Loader2 size={16} className="animate-spin" /> : null}
                <span>{deleting ? "جاري الحذف…" : "تأكيد الحذف"}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
