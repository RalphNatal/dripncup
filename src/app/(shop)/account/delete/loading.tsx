import { FormSkeleton } from "@/components/skeletons";

export default function Loading() {
  return <FormSkeleton label="the form" fields={2} />;
}
