import { initials } from "@/lib/focus";

export default function Avatar({ name, picture, size = 40, accent = "var(--accent)" }) {
  if (picture) {
    return <img src={picture} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, background: `linear-gradient(135deg, ${accent}, #7c6bd6)`,
      color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: Math.round(size * 0.34), fontWeight: 700 }}>
      {initials(name)}
    </div>
  );
}
