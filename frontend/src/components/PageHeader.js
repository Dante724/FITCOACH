export default function PageHeader({ eyebrow, title, subtitle, action }) {
  return (
    <div className="fade-up" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24, gap: 16, flexWrap: "wrap" }}>
      <div>
        {eyebrow && <div className="eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</div>}
        <h1 style={{ fontSize: 28 }}>{title}</h1>
        {subtitle && <p style={{ fontSize: 14.5, color: "var(--text-2)", marginTop: 6, maxWidth: 560 }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
