import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import * as Icons from "lucide-react";
import PageHeader from "@/components/PageHeader";
import StickFigure from "@/components/StickFigure";
import ExerciseModal from "@/components/ExerciseCard";
import { LEVEL_LABEL, TABS, groupsOf, loadLibrary, search } from "@/lib/library";

const EXAMPLES = ["baithak", "kamar dard", "छाती", "pet ki charbi", "knee friendly", "dumbbell", "tadasana", "neend"];

export function LibraryGrid({ items, onPick, compact = false }) {
  if (!items.length) return null;
  return (
    <div className={compact ? "stack" : "lib-grid"} style={compact ? { gap: 8 } : undefined}>
      {items.map((e) => (
        <button key={e.id} type="button" className="clay-inset lib-item" onClick={() => onPick(e)} data-testid={`lib-${e.id}`}>
          <StickFigure figure={e.figure} size={compact ? 52 : 64} title={e.name} />
          <span className="min0" style={{ flex: 1, textAlign: "left" }}>
            <span className="truncate" style={{ display: "block", fontWeight: 600, fontSize: 14 }}>{e.name}</span>
            <span className="truncate" style={{ display: "block", fontSize: 13, color: "var(--text-2)" }} lang="hi">{e.hindi}{e.sanskrit ? ` · ${e.sanskrit}` : ""}</span>
            <span style={{ display: "block", fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>{e.group} · {LEVEL_LABEL[e.level] || e.level}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export default function Library() {
  const [params, setParams] = useSearchParams();
  const [lib, setLib] = useState(null);
  const [failed, setFailed] = useState(false);
  const tab = TABS.some((t) => t.key === params.get("tab")) ? params.get("tab") : "home";
  const q = params.get("q") || "";
  const group = params.get("group") || "";
  const open = lib && params.get("id") ? lib.byId.get(params.get("id")) : null;
  const set = (patch) => setParams((p) => {
    const next = new URLSearchParams(p);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    return next;
  }, { replace: true });

  useEffect(() => { loadLibrary().then(setLib).catch(() => setFailed(true)); }, []);

  // While searching, look across all three tabs and show how many hits each has.
  const results = useMemo(() => (lib ? search(lib, q, q ? {} : { category: tab, group }) : []), [lib, q, tab, group]);
  const shown = q ? results.filter((e) => e.category === tab) : results;
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, results.filter((e) => e.category === t.key).length])), [results]);
  useEffect(() => { // jump to the tab that has results
    if (q && counts[tab] === 0) {
      const best = TABS.find((t) => counts[t.key] > 0);
      if (best) set({ tab: best.key });
    }
  }, [q, counts]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div data-testid="library">
      <PageHeader eyebrow="Learn" title="Exercise & yoga library" subtitle="Home workouts, gym workouts and yoga poses — in English and Hindi, with how to do each one safely." />

      <div className="clay fade-up" style={{ padding: 14, marginBottom: 14 }}>
        <div className="row" style={{ gap: 10 }}>
          <Icons.Search size={18} color="var(--text-3)" />
          <input className="field" style={{ border: "none", background: "transparent", padding: "6px 0", boxShadow: "none" }} value={q} autoFocus={false}
            onChange={(ev) => set({ q: ev.target.value, group: "" })} placeholder="Search in English or Hindi — squat, baithak, kamar dard, छाती…" aria-label="Search the library" data-testid="lib-search" />
          {q && <button className="icon-btn" onClick={() => set({ q: "" })} aria-label="Clear search"><Icons.X size={16} /></button>}
        </div>
        {!q && (
          <div className="row-wrap" style={{ gap: 6, marginTop: 8 }}>
            <span style={{ fontSize: 12, color: "var(--text-3)" }}>Try:</span>
            {EXAMPLES.map((x) => <button key={x} className="pill" style={{ fontSize: 12, padding: "3px 10px" }} onClick={() => set({ q: x })}>{x}</button>)}
          </div>
        )}
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => {
          const Icon = Icons[t.icon] || Icons.Circle;
          return (
            <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab${tab === t.key ? " active" : ""}`} onClick={() => set({ tab: t.key, group: "" })} data-testid={`lib-tab-${t.key}`}>
              <Icon size={16} /> {t.label}{lib ? <span style={{ opacity: 0.6, marginLeft: 4 }}>({q ? counts[t.key] : lib.entries.filter((e) => e.category === t.key).length})</span> : null}
            </button>
          );
        })}
      </div>

      {lib && !q && (
        <div className="row-wrap" style={{ gap: 6, margin: "4px 0 14px" }}>
          <button className={`pill${!group ? " on" : ""}`} onClick={() => set({ group: "" })}>All</button>
          {groupsOf(lib, tab).map((g) => <button key={g} className={`pill${group === g ? " on" : ""}`} onClick={() => set({ group: g })}>{g}</button>)}
        </div>
      )}

      {failed && <div className="clay empty">Couldn't load the library. Check your connection and try again.</div>}
      {!lib && !failed && <div className="spinner" style={{ margin: "60px auto" }} />}
      {lib && shown.length === 0 && (
        <div className="clay empty" data-testid="lib-empty">Nothing found for “{q}”. Try another word — e.g. the body part (pet, kamar, pair) or the English name.</div>
      )}
      {lib && <LibraryGrid items={shown} onPick={(e) => set({ id: e.id })} />}
      {open && <ExerciseModal e={open} onClose={() => set({ id: "" })} />}
    </div>
  );
}
