// Plain-language judgements about call connections, shared by the call screen and the call test page.

// From WebRTC stats: round-trip time (seconds) and the share of packets lost in the last few seconds.
export function rateQuality(rttSeconds, lossRate) {
  if (rttSeconds == null && lossRate == null) return null;
  if ((rttSeconds ?? 0) > 0.45 || (lossRate ?? 0) > 0.08) return "poor";
  if ((rttSeconds ?? 0) > 0.22 || (lossRate ?? 0) > 0.03) return "fair";
  return "good";
}

// From the kinds of network routes the browser found: host (local), srflx (direct via STUN), relay (TURN).
export function networkVerdict(types, relayConfigured) {
  if (types.includes("relay")) return { level: "good", title: "Ready on any network", text: "Calls can connect even if your network blocks direct connections." };
  if (types.includes("srflx")) {
    return relayConfigured
      ? { level: "fair", title: "Should work", text: "Direct connection looks fine. The relay didn't answer this time — if a call won't connect, try mobile data." }
      : { level: "fair", title: "Works on most networks", text: "Some mobile and office networks block video calls. If a call won't connect, switch between Wi-Fi and mobile data." };
  }
  return { level: "poor", title: "Calls may not connect from here", text: "This network seems to block video calls. Try mobile data or another Wi-Fi." };
}
