import { cache } from "react";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Metadata } from "next";
import { readerToPlace, type PlaceReaderRow } from "./hydrate";
import type { Place } from "./types";
import type { Channel } from "@/lib/chat/types";
import { createClient } from "@/lib/supabase/server";

/** The request's own origin, so OG image URLs always match whatever
 * domain/preview URL actually served the page — never hardcoded. */
export async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

/** A single place by primary key — the deep-link entry point (`place_by_id`
 * is public-read, safe for anon crawlers hitting generateMetadata). */
export async function getPlaceById(supabase: SupabaseClient, id: string): Promise<Place | null> {
  const { data } = await supabase.rpc("place_by_id", { p_id: id });
  const row = (data as PlaceReaderRow[] | null)?.[0];
  return row ? readerToPlace(row, "db") : null;
}

export async function getPlaceChannels(supabase: SupabaseClient, placeId: string): Promise<Channel[]> {
  const { data } = await supabase.rpc("place_channels", { p_place_id: placeId });
  return (data ?? []) as Channel[];
}

/** Resolves a requested slug to its channel, falling back to #general (or the
 * first channel) — a bad/stale/missing slug in a shared link never errors. */
export function resolveChannel(channels: Channel[], requestedSlug?: string | null): Channel | null {
  const requested = requestedSlug ? channels.find((c) => c.slug === requestedSlug) : null;
  return requested ?? channels.find((c) => c.slug === "general") ?? channels[0] ?? null;
}

/** Count-only activity signal for link previews — never message content. */
export async function getChannelActivity(supabase: SupabaseClient, channelId: string): Promise<number> {
  const { data } = await supabase.rpc("channel_weekly_activity", { p_channel_id: channelId });
  return typeof data === "number" ? data : 0;
}

export interface ResolvedDeepLink {
  place: Place | null;
  channels: Channel[];
  channel: Channel | null;
}

/**
 * Everything a `/p/[placeId]/[channelSlug]` route needs, fetched once and
 * shared between `generateMetadata` and the page body (both call this per
 * request; `cache()` collapses them to one round trip).
 */
export const loadDeepLink = cache(
  async (placeId: string, requestedSlug?: string | null): Promise<ResolvedDeepLink> => {
    const supabase = await createClient();
    const place = await getPlaceById(supabase, placeId);
    if (!place) return { place: null, channels: [], channel: null };
    const channels = await getPlaceChannels(supabase, placeId);
    return { place, channels, channel: resolveChannel(channels, requestedSlug) };
  }
);

/**
 * OG/Twitter metadata for a place+channel deep link. Custom pins never get a
 * map-thumbnail image — a link preview centered exactly on someone's pin is a
 * meaningfully bigger exposure than the link itself. Never includes message
 * content, only an activity count.
 */
export function buildDeepLinkMetadata({
  place,
  channel,
  activityCount,
  origin,
}: {
  place: Place;
  channel: Channel | null;
  activityCount: number;
  origin: string;
}): Metadata {
  const channelLabel = `#${channel?.name ?? "general"}`;
  const title = `${place.name} — ${channelLabel} on Gazetteer`;
  const description = `${activityCount} ${activityCount === 1 ? "message" : "messages"} this week`;

  const image =
    place.kind === "custom"
      ? null
      : `${origin}/api/og?${new URLSearchParams({ name: place.name, channel: channelLabel }).toString()}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      ...(image ? { images: [{ url: image, width: 1200, height: 630 }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}
