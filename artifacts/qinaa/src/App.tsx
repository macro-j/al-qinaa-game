import { VenetianMask, Plus, LogIn, Settings } from "lucide-react";

function MainMenu() {
  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center px-6"
      style={{ backgroundColor: "#000000", direction: "rtl" }}
    >
      <div className="flex flex-col items-center gap-8 w-full max-w-sm">
        <div className="flex flex-col items-center gap-3">
          <VenetianMask size={80} color="#D32F2F" strokeWidth={1.5} />
          <h1
            className="text-6xl font-black tracking-widest"
            style={{ color: "#D32F2F", fontFamily: "serif" }}
          >
            قناع
          </h1>
          <p
            className="text-sm text-center"
            style={{ color: "#9E9E9E", fontFamily: "sans-serif" }}
          >
            المدينة تنام.. والقاتل يصحو
          </p>
        </div>

        <div className="flex flex-col gap-5 w-full">
          <button
            className="flex flex-row-reverse items-center gap-4 w-full px-6 py-4 rounded-xl border font-bold text-white text-lg transition-all duration-200 hover:brightness-125 active:scale-95"
            style={{
              backgroundColor: "#1A1A1A",
              borderColor: "#D32F2F",
              fontFamily: "sans-serif",
            }}
          >
            <Plus size={22} color="#D32F2F" strokeWidth={2.5} />
            <span>إنشاء غرفة</span>
          </button>

          <button
            className="flex flex-row-reverse items-center gap-4 w-full px-6 py-4 rounded-xl border font-bold text-white text-lg transition-all duration-200 hover:brightness-125 active:scale-95"
            style={{
              backgroundColor: "#1A1A1A",
              borderColor: "#D32F2F",
              fontFamily: "sans-serif",
            }}
          >
            <LogIn size={22} color="#D32F2F" strokeWidth={2.5} />
            <span>دخول لعبة</span>
          </button>

          <button
            className="flex flex-row-reverse items-center gap-4 w-full px-6 py-4 rounded-xl border font-bold text-white text-lg transition-all duration-200 hover:brightness-125 active:scale-95"
            style={{
              backgroundColor: "#1A1A1A",
              borderColor: "#D32F2F",
              fontFamily: "sans-serif",
            }}
          >
            <Settings size={22} color="#D32F2F" strokeWidth={2.5} />
            <span>إعدادات</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return <MainMenu />;
}
