import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// The signed-in client's assigned coaches: { fitness, yoga, needs }.
export default function useCoaches() {
  const [coaches, setCoaches] = useState(null);
  useEffect(() => { api.get("/my/coaches").then((r) => setCoaches(r.data)).catch(() => setCoaches({})); }, []);
  return coaches;
}
