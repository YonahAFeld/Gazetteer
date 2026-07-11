import type { Metadata } from "next";
import MapLoader from "@/components/map/MapLoader";
import AccountControl from "@/components/auth/AccountControl";
import { loadDeepLink, buildDeepLinkMetadata, getChannelActivity, getRequestOrigin } from "@/lib/geo/deeplink";
import { createClient } from "@/lib/supabase/server";

interface PageProps {
  params: Promise<{ placeId: string; channelSlug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { placeId, channelSlug } = await params;
  const { place, channel } = await loadDeepLink(placeId, channelSlug);
  if (!place) return {};

  const supabase = await createClient();
  const [activityCount, origin] = await Promise.all([
    channel ? getChannelActivity(supabase, channel.id) : Promise.resolve(0),
    getRequestOrigin(),
  ]);
  return buildDeepLinkMetadata({ place, channel, activityCount, origin });
}

/**
 * `/p/[placeId]/[channelSlug]` — a shareable link to one exact channel. A
 * slug that doesn't match any of the place's channels falls back to the
 * default channel rather than erroring (SPEC: shareable links).
 */
export default async function PlaceChannelPage({ params }: PageProps) {
  const { placeId, channelSlug } = await params;
  const { place, channel } = await loadDeepLink(placeId, channelSlug);

  return (
    <main className="relative h-full w-full">
      <MapLoader initialPlace={place} initialChannelSlug={channel?.slug ?? null} />
      <AccountControl />
    </main>
  );
}
