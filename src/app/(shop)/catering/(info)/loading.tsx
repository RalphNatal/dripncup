import { FormSkeleton } from "@/components/skeletons";

export default function Loading() {
  return <FormSkeleton label="the catering form" fields={7} wide />;
}
