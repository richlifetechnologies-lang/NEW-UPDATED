import { Monitor, Lock, Info, Wifi } from "lucide-react";

export function NoticeBanner() {
  return (
    <div className="mb-6 rounded-xl overflow-hidden"
         style={{ background: "hsl(222 44% 7%)", border: "1px solid hsl(187 100% 52% / 0.2)" }}>
      <div className="flex items-center gap-2 px-4 py-2"
           style={{ background: "hsl(187 100% 52% / 0.08)", borderBottom: "1px solid hsl(187 100% 52% / 0.15)" }}>
        <Info className="w-3.5 h-3.5 shrink-0" style={{ color: "#fff" }} />
        <p className="text-[11px] font-bold tracking-widest uppercase" style={{ color: "#fff" }}>Platform Notice</p>
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-start gap-2.5">
          <Monitor className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#fff" }} />
          <p className="text-xs leading-relaxed" style={{ color: "#fff" }}>
            This software runs on <span className="font-medium">all machines</span> — gaming PCs, non-gaming laptops, and desktop computers.
          </p>
        </div>
        <div className="flex items-start gap-2.5">
          <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#fff" }} />
          <p className="text-xs leading-relaxed" style={{ color: "#fff" }}>
            All streaming data is <span className="font-medium">permanently deleted</span> the moment your live session ends. No data is stored — your streaming stays <span className="font-medium">completely private</span>.
          </p>
        </div>
        <div className="flex items-start gap-2.5">
          <Wifi className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "#fff" }} />
          <p className="text-xs leading-relaxed" style={{ color: "#fff" }}>
            Streaming quality and performance depend on your <span className="font-medium">WiFi connectivity</span>, not your local machine or PC specifications.
          </p>
        </div>
      </div>
    </div>
  );
}
