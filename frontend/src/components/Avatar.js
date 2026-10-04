import { initials } from "@/lib/focus";
import { fileSrc } from "@/lib/api";

export default function Avatar({ name, picture, size = 40 }) {
  if (picture) {
    return <img src={fileSrc(picture)} alt="" style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, background: "var(--surface-2)", border: "1px solid var(--border)",
      color: "var(--text-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: Math.round(size * 0.36), fontWeight: 500 }}>
      {initials(name)}
    </div>
  );
}
