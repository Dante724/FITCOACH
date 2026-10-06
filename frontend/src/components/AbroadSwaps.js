import { useState } from "react";
import * as Icons from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { allSwaps, isAbroad, swapsFor } from "@/lib/locale";

// For clients living outside India: easy swaps for ingredients that are hard to find abroad.
// With `texts` (a plan's meals and items) it shows only what that plan uses; without, the full list.
export default function AbroadSwaps({ texts, title = "Living abroad? Easy swaps", collapsed = false }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(!collapsed);
  if (!isAbroad(user)) return null;
  const swaps = texts ? swapsFor(texts) : allSwaps().map((s) => ({ item: s.for[0], swap: s.swap, why: s.why }));
  if (!swaps.length) return null;
  return (
    <div className="clay-inset" style={{ padding: "14px 16px", marginTop: 14 }} data-testid="abroad-swaps">
      <button type="button" className="row" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        style={{ width: "100%", justifyContent: "space-between", background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", color: "inherit" }}>
        <span className="row" style={{ gap: 8, fontWeight: 600, fontSize: 14 }}><Icons.Globe size={16} color="var(--teal)" /> {title}</span>
        <Icons.ChevronDown size={16} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>
      {open && (
        <div className="stack" style={{ gap: 10, marginTop: 12 }}>
          {swaps.map((s) => (
            <div key={s.item} style={{ fontSize: 13.5, lineHeight: 1.55 }}>
              <strong style={{ textTransform: "capitalize" }}>{s.item}</strong> → {s.swap}
              <div style={{ fontSize: 12, color: "var(--text-3)" }}>{s.why}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
