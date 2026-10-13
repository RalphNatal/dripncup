import { ListSkeleton } from "@/components/skeletons";

export default function Loading() {
  return <ListSkeleton label="events" rows={3} />;
}
