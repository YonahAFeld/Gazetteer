import type { Metadata } from "next";
import MapLoader from "@/components/map/MapLoader";
import AccountControl from "@/components/auth/AccountControl";
import { loadDeepLink, buildDeepLinkMetadata, getChannelActivity, getRequestOrigin } from "@/lib/geo/deeplink";
import { createClient } from "@/lib/supabase/server";

interface PageProps {
  params: Promise<{ placeId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { placeId } = await params;
  const { place, channel } = await loadDeepLink(placeId);
  if (!place) return {};

  const supabase = await createClient();
  const [activityCount, origin] = await Promise.all([
    channel ? getChannelActivity(supabase, channel.id) : Promise.resolve(0),
    getRequestOrigin(),
  ]);
  return buildDeepLinkMetadata({ place, channel, activityCount, origin });
}

/**
 * `/p/[placeId]` — a shareable link to a place, default channel active.
 * A placeId that doesn't resolve (stale/bad link) falls back to the plain
 * map rather than a dead end: there's no OSM identity in the URL to hydrate
 * from, so there's nothing to recover — just let people keep using the app.
 */
export default async function PlacePage({ params }: PageProps) {
  const { placeId } = await params;
  const { place, channel } = await loadDeepLink(placeId);

  return (
    <main className="relative h-full w-full">
      <MapLoader initialPlace={place} initialChannelSlug={channel?.slug ?? null} />
      <AccountControl />
    </main>
  );
}
