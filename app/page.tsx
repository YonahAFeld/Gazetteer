import MapLoader from "@/components/map/MapLoader";
import AccountControl from "@/components/auth/AccountControl";

export default function Home() {
  return (
    <main className="relative h-full w-full">
      <MapLoader />
      <AccountControl />
    </main>
  );
}
