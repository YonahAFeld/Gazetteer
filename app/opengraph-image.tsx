import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Gazetteer — open source, channels for every place";

const PAPER = "#F7F5EF";
const INK = "#1A1A18";
const MAGENTA = "#C2187A";
const CONTOUR = "#B8B2A3";

/** Generic link-preview card for the bare app URL (no place/channel context) —
 * static, prerendered at build time. Deep links get their own dynamic card
 * via /api/og; see lib/geo/deeplink.ts. */
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: PAPER,
          padding: 64,
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            border: `2px solid ${INK}`,
            borderRadius: 4,
            width: "100%",
            height: "100%",
            padding: 56,
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", fontSize: 20, letterSpacing: 6, color: CONTOUR, textTransform: "uppercase" }}>
            Gazetteer
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 72, color: INK, fontStyle: "italic", lineHeight: 1.1 }}>
              Every place is a channel.
            </div>
            <div style={{ display: "flex", marginTop: 24, fontSize: 32, color: MAGENTA, letterSpacing: 1 }}>
              Open the map. Pick a spot. Start talking.
            </div>
          </div>

          <div style={{ display: "flex", fontSize: 20, color: CONTOUR }}>
            Open source. Channels for every place.
          </div>
        </div>
      </div>
    ),
    size
  );
}
