import { ImageResponse } from "next/og";

export const runtime = "edge";

const PAPER = "#F7F5EF";
const INK = "#1A1A18";
const MAGENTA = "#C2187A";
const CONTOUR = "#B8B2A3";

/**
 * Branded link-preview card — no real map. This app has no static/raster map
 * capability (OpenFreeMap only serves vector tiles for MapLibre), and hotlinking
 * OSM's raster tile server from a public, crawler-hit endpoint risks the exact
 * kind of usage-policy trouble this project already treats carefully for
 * Nominatim. A stylized card costs nothing and fits the ink-on-paper aesthetic.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = (searchParams.get("name") ?? "Gazetteer").slice(0, 80);
  const channel = (searchParams.get("channel") ?? "#general").slice(0, 40);

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
              {name}
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 24,
                fontSize: 32,
                color: MAGENTA,
                letterSpacing: 1,
              }}
            >
              {channel}
            </div>
          </div>

          <div style={{ display: "flex", fontSize: 20, color: CONTOUR }}>
            Open source. Channels for every place.
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
