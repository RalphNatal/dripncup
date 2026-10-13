import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Loading placeholders for every route's loading.tsx, shaped like the page
 * they stand in for so nothing jumps when it arrives. Each says "Loading…"
 * to screen readers once (a polite status), and the shimmer stops under
 * prefers-reduced-motion (globals.css).
 */

function Loading({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">Loading {label}…</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

function Title({ className }: { className?: string }) {
  return <Skeleton className={cn("h-9 w-44 rounded-xl", className)} />;
}

function Lines({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cn("h-4 rounded-md", i === count - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}

function Card({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-3xl border bg-card p-4 sm:p-5", className)}>
      <Skeleton className="h-6 w-40 rounded-lg" />
      <div className="mt-3">
        <Lines />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customer app
// ---------------------------------------------------------------------------

export function HomeSkeleton() {
  return (
    <Loading label="your home page" className="mx-auto max-w-2xl space-y-5">
      <div className="rounded-[2rem] bg-brand-wash px-6 pt-7 pb-8">
        <Skeleton className="h-5 w-24 rounded-md bg-white/70" />
        <Skeleton className="mt-3 h-10 w-64 max-w-full rounded-xl bg-white/70" />
        <Skeleton className="mt-4 h-4 w-56 max-w-full rounded-md bg-white/70" />
        <Skeleton className="mt-6 h-12 w-44 rounded-full bg-white/70" />
      </div>
      <Card />
      <Card />
    </Loading>
  );
}

/** A narrow page of cards or rows: orders, events, favorites, catering requests. */
export function ListSkeleton({ label, rows = 4, narrow = true }: { label: string; rows?: number; narrow?: boolean }) {
  return (
    <Loading label={label} className={cn("space-y-4", narrow && "mx-auto w-full max-w-md")}>
      <Title className="mt-2" />
      <div className="space-y-3 pt-2">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-3xl border bg-card p-4">
            <Skeleton className="size-12 shrink-0 rounded-2xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-1/2 rounded-md" />
              <Skeleton className="h-4 w-3/4 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** One thing in detail: an event, a catering request. */
export function DetailSkeleton({ label }: { label: string }) {
  return (
    <Loading label={label} className="mx-auto w-full max-w-2xl space-y-4">
      <Skeleton className="aspect-[16/7] w-full rounded-3xl" />
      <Title className="w-64 max-w-full" />
      <Lines count={2} />
      <Card />
      <Card />
    </Loading>
  );
}

export function TrackerSkeleton() {
  return (
    <Loading label="your order" className="mx-auto w-full max-w-xl space-y-4">
      <Skeleton className="h-4 w-14 rounded-md" />
      <Skeleton className="h-9 w-56 rounded-xl" />
      <Skeleton className="h-4 w-64 max-w-full rounded-md" />
      <div className="rounded-3xl border bg-card p-4 sm:p-5">
        <div className="flex justify-between">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="size-9 rounded-full" />
          ))}
        </div>
      </div>
      <Card />
      <Card />
    </Loading>
  );
}

export function ConfirmationSkeleton() {
  return (
    <Loading label="your order" className="mx-auto w-full max-w-xl space-y-4">
      <div className="flex flex-col items-center gap-3 py-4">
        <Skeleton className="size-10 rounded-full" />
        <Skeleton className="h-9 w-40 rounded-xl" />
        <Skeleton className="h-4 w-56 rounded-md" />
        <Skeleton className="h-10 w-52 rounded-xl" />
      </div>
      <Card />
      <Card />
    </Loading>
  );
}

export function CartSkeleton() {
  return (
    <Loading label="your cart" className="mx-auto w-full max-w-md space-y-4">
      <Title className="mt-2 w-24" />
      <Skeleton className="h-12 w-full rounded-2xl" />
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="flex gap-3 rounded-3xl border bg-card p-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-1/2 rounded-md" />
            <Skeleton className="h-4 w-3/4 rounded-md" />
            <Skeleton className="mt-2 h-11 w-32 rounded-full" />
          </div>
          <Skeleton className="h-5 w-14 rounded-md" />
        </div>
      ))}
      <div className="rounded-3xl border bg-card p-4">
        <Lines count={2} />
        <Skeleton className="mt-4 h-12 w-full rounded-full" />
      </div>
    </Loading>
  );
}

/** Checkout, and paying for a catering quote: stacked sections ending in Pay. */
export function CheckoutSkeleton({ label = "checkout" }: { label?: string }) {
  return (
    <Loading label={label} className="mx-auto w-full max-w-md space-y-5">
      <Title className="mt-2 w-36" />
      {["h-28", "h-40", "h-32", "h-24"].map((height, i) => (
        <div key={i} className="rounded-3xl border bg-card p-4 sm:p-5">
          <Skeleton className="h-6 w-28 rounded-lg" />
          <Skeleton className={cn("mt-3 w-full rounded-2xl", height)} />
        </div>
      ))}
      <Skeleton className="h-12 w-full rounded-full" />
    </Loading>
  );
}

export function RewardsSkeleton() {
  return (
    <Loading label="your rewards" className="mx-auto w-full max-w-2xl space-y-5">
      <Title className="mt-2 w-56" />
      <div className="rounded-3xl bg-brand-pink-soft p-5">
        <Skeleton className="h-10 w-32 rounded-xl bg-white/70" />
        <Skeleton className="mt-4 h-3 w-full rounded-full bg-white/70" />
        <Skeleton className="mt-2 h-4 w-48 rounded-md bg-white/70" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-3xl" />
        ))}
      </div>
      <Card />
    </Loading>
  );
}

/** Forms: account, password, catering request, deleting an account. */
export function FormSkeleton({ label, fields = 5, wide = false }: { label: string; fields?: number; wide?: boolean }) {
  return (
    <Loading label={label} className={cn("mx-auto w-full space-y-5", wide ? "max-w-2xl" : "max-w-md")}>
      <Title className="mt-2 w-48" />
      <div className="space-y-4 rounded-3xl border bg-card p-4 sm:p-5">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-28 rounded-md" />
            <Skeleton className="h-11 w-full rounded-xl" />
          </div>
        ))}
        <Skeleton className="h-12 w-full rounded-full" />
      </div>
    </Loading>
  );
}

/** About, privacy, terms, accessibility: a title and paragraphs. */
export function TextPageSkeleton({ label }: { label: string }) {
  return (
    <Loading label={label} className="mx-auto w-full max-w-md space-y-5">
      <Title className="mt-2 w-52" />
      {Array.from({ length: 3 }, (_, i) => (
        <Lines key={i} count={4} />
      ))}
    </Loading>
  );
}

/** A seasonal collection: its banner, then a grid of drinks. */
export function CollectionSkeleton() {
  return (
    <Loading label="the collection" className="space-y-5">
      <Skeleton className="h-44 w-full rounded-[2rem]" />
      <div className="grid gap-3 md:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex gap-3 rounded-3xl border bg-card p-3">
            <Skeleton className="size-24 shrink-0 rounded-2xl" />
            <div className="flex-1 space-y-2 py-1">
              <Skeleton className="h-5 w-3/4 rounded-md" />
              <Skeleton className="h-4 w-full rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </Loading>
  );
}

export function AuthFormSkeleton() {
  return (
    <Loading label="the form" className="space-y-4">
      <Skeleton className="h-8 w-40 rounded-xl" />
      {Array.from({ length: 2 }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-20 rounded-md" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
      ))}
      <Skeleton className="h-11 w-full rounded-full" />
    </Loading>
  );
}

// ---------------------------------------------------------------------------
// Staff and admin
// ---------------------------------------------------------------------------

export function StaffSkeleton() {
  return (
    <Loading label="the order queue" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-10 w-64 rounded-xl" />
        <Skeleton className="h-14 w-40 rounded-2xl" />
      </div>
      <div className="grid gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, column) => (
          <div key={column} className="space-y-3 rounded-3xl bg-muted/50 p-3">
            <Skeleton className="h-7 w-28 rounded-lg" />
            {Array.from({ length: column === 1 ? 2 : 1 }, (_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-2xl" />
            ))}
          </div>
        ))}
      </div>
    </Loading>
  );
}

export function AdminHomeSkeleton() {
  return (
    <Loading label="the admin dashboard" className="max-w-5xl space-y-6">
      <Title className="w-56" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Card />
      <Card />
    </Loading>
  );
}

/** Admin lists: filters, then a table. */
export function AdminListSkeleton({ label }: { label: string }) {
  return (
    <Loading label={label} className="max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Title className="w-48" />
        <Skeleton className="h-11 w-36 rounded-full" />
      </div>
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-40 rounded-xl" />
        ))}
      </div>
      <div className="overflow-hidden rounded-2xl border bg-card">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-0">
            <Skeleton className="h-4 w-1/4 rounded-md" />
            <Skeleton className="h-4 w-1/3 rounded-md" />
            <Skeleton className="ml-auto h-4 w-16 rounded-md" />
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** Admin editors and settings: sections of fields. */
export function AdminFormSkeleton({ label }: { label: string }) {
  return (
    <Loading label={label} className="max-w-3xl space-y-5">
      <Skeleton className="h-4 w-24 rounded-md" />
      <Title className="w-64 max-w-full" />
      {Array.from({ length: 3 }, (_, section) => (
        <div key={section} className="space-y-4 rounded-2xl border bg-card p-5">
          <Skeleton className="h-6 w-40 rounded-lg" />
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-28 rounded-md" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
          ))}
        </div>
      ))}
    </Loading>
  );
}

export function AdminReportsSkeleton() {
  return (
    <Loading label="the reports" className="max-w-6xl space-y-5">
      <Title className="w-40" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-32 rounded-full" />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-2xl" />
    </Loading>
  );
}
