export default function PageHeader({ eyebrow, title, subtitle, action }) {
  return (
    <div className="fade-up" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 28, gap: 20, flexWrap: "wrap" }}>
      <div>
        {eyebrow && <div className="eyebrow" style={{ marginBottom: 8 }}>{eyebrow}</div>}
        <h1 style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.05 }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 14.5, color: "var(--text-2)", marginTop: 8, maxWidth: 560 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
