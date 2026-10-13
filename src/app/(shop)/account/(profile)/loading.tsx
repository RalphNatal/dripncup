import { FormSkeleton } from "@/components/skeletons";

export default function Loading() {
  return <FormSkeleton label="your account" fields={6} />;
}
