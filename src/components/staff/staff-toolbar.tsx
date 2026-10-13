"use client";

/**
 * The staff screen's toolbar, always at the top.
 *
 *   left     location (and switcher), open / closed / paused, today's hours
 *   centre   the Honolulu clock; orders today, average time to ready, waiting
 *   right    Pause online orders, Sold out, Catering, Completed, Settings
 *
 * On tablets and up the three groups sit in one row and the actions wrap to a
 * second row only when the screen is too narrow for all of them; nothing is
 * moved into a menu. On a phone the toolbar is one compact row (location,
 * status, clock, Pause) and everything else is in the Menu sheet.
 *
 * Settings (sound, fullscreen, ticket density, theme, shortcuts) are per
 * device and live in device.ts.
 */
import {
  ChefHat,
  ClipboardList,
  Keyboard,
  Maximize,
  Menu,
  Minimize,
  Moon,
  PackageX,
  Rows3,
  Rows4,
  Settings,
  Sun,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getLocationStatus, statusLabel, todaysHoursText } from "@/lib/locations/status";
import { formatCafeTimeOfDay } from "@/lib/time";
import { cn } from "@/lib/utils";

import { rememberStaffLocation } from "@/lib/staff/actions";
import type { StaffLocationOption } from "@/lib/staff/locations";
import type { QueueSummary } from "@/lib/staff/queue";
import type { StaffLocationContext } from "@/lib/staff/types";

import { toggleFullscreen, unlockAudio, useDisplaySettings, useIsFullscreen, useSoundSettings } from "./device";
import { PauseButton } from "./pause-control";

export type StaffPanel = "sold-out" | "catering" | "completed";

// ---------------------------------------------------------------------------
// Location: name, switcher, status and today's hours.
// ---------------------------------------------------------------------------

export function LocationHeading({
  location,
  options,
  now,
  accepting,
  onlineOrderingEnabled,
  size = "large",
  showHours = true,
  stacked = false,
}: {
  location: StaffLocationContext;
  options: StaffLocationOption[];
  now: Date | null;
  accepting?: boolean;
  onlineOrderingEnabled?: boolean;
  /** large: the Start shift screen and the toolbar; small: the phone toolbar. */
  size?: "large" | "small";
  showHours?: boolean;
  /** Name on one line, status and hours under it (the toolbar). */
  stacked?: boolean;
}) {
  const router = useRouter();
  const [switching, startSwitch] = useTransition();
  const at = now ?? new Date();
  const statusLocation = {
    id: location.id,
    type: location.type,
    acceptingOrders: accepting ?? location.acceptingOrders,
    startsAt: location.startsAt,
    endsAt: location.endsAt,
  };
  const status = getLocationStatus({
    location: statusLocation,
    hours: location.hours,
    closures: location.closures,
    now: at,
    onlineOrderingEnabled: onlineOrderingEnabled ?? location.onlineOrderingEnabled,
  });
  const today = todaysHoursText({ location: statusLocation, hours: location.hours, closures: location.closures, now: at });
  const small = size === "small";

  return (
    <div
      className={cn(
        "flex min-w-0",
        stacked ? "flex-col gap-0.5" : "flex-wrap items-center",
        !stacked && (small ? "gap-x-2 gap-y-0.5" : "gap-x-3 gap-y-1"),
      )}
    >
      {options.length > 1 ? (
        <label className="min-w-0 max-w-full">
          <span className="sr-only">Location</span>
          <select
            value={location.id}
            disabled={switching}
            onChange={(event) => {
              const id = event.target.value;
              startSwitch(async () => {
                const result = await rememberStaffLocation(id);
                if (!result.ok) {
                  toast.error(result.message);
                  return;
                }
                router.replace("/staff");
                router.refresh();
              });
            }}
            className={cn(
              "focus-ring min-h-14 max-w-full truncate rounded-xl border-2 border-staff-line bg-staff-card pr-10 pl-3 font-heading font-extrabold",
              small ? "text-lg" : "text-2xl",
            )}
            data-testid="location-switcher"
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
                {option.type === "event" ? " (pop-up)" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <h1
          className={cn("min-w-0 truncate font-heading leading-tight font-extrabold", small ? "max-w-full text-lg" : "max-w-full text-2xl lg:max-xl:text-xl")}
          data-testid="location-name"
        >
          {location.name}
        </h1>
      )}
      <span className={cn("flex min-w-0 items-center", small ? "gap-2" : "gap-3")}>
        <span
          data-testid="location-status"
          className={cn(
            "shrink-0 rounded-full font-extrabold whitespace-nowrap",
            small ? "px-2 py-px text-sm" : "px-3 py-0.5 text-base",
            status.kind === "open" && "bg-staff-fill-ready text-white",
            status.kind === "paused" && "bg-staff-fill-warn text-white",
            (status.kind === "closed" || status.kind === "event") && "bg-staff-chip text-foreground",
          )}
        >
          {statusLabel(status, at)}
        </span>
        {showHours ? (
          <span className={cn("min-w-0 truncate text-muted-foreground", small ? "text-sm" : "text-base")} data-testid="todays-hours">
            Today: {today.hours}
            {today.note ? ` · ${today.note}` : ""}
          </span>
        ) : null}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clock and stats.
// ---------------------------------------------------------------------------

/** "10:42 AM" in Honolulu, with a smaller AM/PM. */
function Clock({ now, small = false }: { now: Date; small?: boolean }) {
  const text = formatCafeTimeOfDay(now);
  const [time, period] = text.split(" ");
  return (
    <p className="flex flex-col leading-none" data-testid="staff-clock">
      <span className="sr-only">Honolulu time </span>
      <time dateTime={now.toISOString()} className={cn("tabular font-extrabold", small ? "text-base" : "text-3xl")}>
        {time}
        {period ? <span className={cn("ml-1 font-bold", small ? "text-xs" : "text-lg")}>{period}</span> : null}
      </time>
      {small ? null : (
        <span className="mt-1 text-sm font-semibold text-muted-foreground" aria-hidden="true">
          Honolulu
        </span>
      )}
    </p>
  );
}

function Stats({ summary, tiles = false }: { summary: QueueSummary; tiles?: boolean }) {
  const average = summary.averageMinutesToReady;
  const items = [
    { label: "Orders today", short: "Today", value: String(summary.ordersToday), unit: null, testId: "summary-orders" },
    {
      label: "Avg to ready",
      short: "Avg ready",
      value: average === null ? "—" : String(average),
      unit: average === null ? null : "min",
      testId: "summary-average",
    },
    { label: "Waiting", short: "Waiting", value: String(summary.waiting), unit: null, testId: "summary-waiting" },
  ];
  return (
    <dl className={cn(tiles ? "grid grid-cols-3 gap-2" : "flex items-stretch gap-3 xl:gap-5")} data-testid="summary">
      {items.map((item) => (
        <div key={item.label} className={cn("flex flex-col-reverse justify-end", tiles && "rounded-xl bg-staff-chip p-3")}>
          <dt className="mt-1 text-sm leading-tight font-semibold whitespace-nowrap text-muted-foreground">
            {tiles ? (
              item.label
            ) : (
              <>
                <span className="lg:max-xl:hidden">{item.label}</span>
                <span className="hidden lg:max-xl:inline">{item.short}</span>
              </>
            )}
          </dt>
          <dd className="tabular text-3xl leading-none font-extrabold" data-testid={item.testId}>
            {item.value}
            {item.unit ? <span className="ml-1 text-base font-bold">{item.unit}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Settings: sound, fullscreen, density, theme, shortcuts.
// ---------------------------------------------------------------------------

function Segmented<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: string; icon: ReactNode }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-bold tracking-wide text-muted-foreground uppercase">{legend}</legend>
      <div className="grid grid-cols-2 gap-1.5">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "relative flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 px-2 text-base font-bold",
              "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-staff-accent/60",
              value === option.value ? "border-staff-accent bg-brand-teal-soft" : "border-staff-line bg-staff-card",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.icon}
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function DisplaySettings({ onShowShortcuts }: { onShowShortcuts?: () => void }) {
  const sound = useSoundSettings();
  const display = useDisplaySettings();
  const fullscreen = useIsFullscreen();
  const canFullscreen = typeof document !== "undefined" && Boolean(document.documentElement.requestFullscreen);

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-1.5 text-sm font-bold tracking-wide text-muted-foreground uppercase">New-order sound</legend>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              unlockAudio();
              sound.setMuted(!sound.muted);
            }}
            aria-pressed={!sound.muted}
            className={cn(
              "focus-ring inline-flex min-h-14 shrink-0 items-center gap-2 rounded-xl border-2 px-3 text-base font-bold",
              sound.muted ? "border-staff-late/60 text-staff-late" : "border-staff-line bg-staff-card",
            )}
          >
            {sound.muted ? <VolumeX className="size-5" aria-hidden="true" /> : <Volume2 className="size-5" aria-hidden="true" />}
            {sound.muted ? "Sound off" : "Sound on"}
          </button>
          <label className="flex min-w-0 flex-1 items-center">
            <span className="sr-only">Alert volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={sound.muted ? 0 : sound.volume}
              onChange={(event) => {
                unlockAudio();
                sound.setVolume(Number(event.target.value));
              }}
              className="h-14 w-full accent-[var(--brand-teal-deep)]"
            />
          </label>
        </div>
      </fieldset>
      <Segmented
        legend="Tickets"
        name="staff-density"
        value={display.density}
        onChange={display.setDensity}
        options={[
          { value: "comfortable", label: "Comfortable", icon: <Rows3 className="size-5" aria-hidden="true" /> },
          { value: "compact", label: "Compact", icon: <Rows4 className="size-5" aria-hidden="true" /> },
        ]}
      />
      <Segmented
        legend="Theme"
        name="staff-theme"
        value={display.theme}
        onChange={display.setTheme}
        options={[
          { value: "light", label: "Light", icon: <Sun className="size-5" aria-hidden="true" /> },
          { value: "dark", label: "Dark", icon: <Moon className="size-5" aria-hidden="true" /> },
        ]}
      />
      <div className="grid gap-1.5">
        {canFullscreen ? (
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-pressed={fullscreen}
            className="focus-ring inline-flex min-h-14 items-center gap-2 rounded-xl border-2 border-staff-line bg-staff-card px-3 text-base font-bold"
          >
            {fullscreen ? <Minimize className="size-5" aria-hidden="true" /> : <Maximize className="size-5" aria-hidden="true" />}
            Fullscreen
          </button>
        ) : null}
        {onShowShortcuts ? (
          <button
            type="button"
            onClick={onShowShortcuts}
            className="focus-ring inline-flex min-h-14 items-center gap-2 rounded-xl border-2 border-staff-line bg-staff-card px-3 text-base font-bold"
          >
            <Keyboard className="size-5" aria-hidden="true" />
            Keyboard shortcuts
            <kbd className="ml-auto rounded border border-staff-line px-1.5 font-mono text-sm">?</kbd>
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The toolbar.
// ---------------------------------------------------------------------------

const TOOL_BUTTON =
  "focus-ring inline-flex min-h-14 shrink-0 items-center gap-2 rounded-xl border border-staff-line bg-staff-card px-3.5 text-base font-bold whitespace-nowrap hover:bg-muted";

/** The same, stacked (icon over label) between 1024 and 1536 px so the toolbar fits one row. */
export const STACKED =
  "md:max-2xl:min-w-[4.25rem] md:max-2xl:flex-col md:max-2xl:justify-center md:max-2xl:gap-0.5 md:max-2xl:px-2 md:max-2xl:text-sm";

function CateringBadge({ count }: { count: number | undefined }) {
  return count ? (
    <span
      className="tabular rounded-full bg-staff-fill-new px-2 text-sm font-extrabold text-white md:max-2xl:absolute md:max-2xl:top-1 md:max-2xl:right-1 md:max-2xl:px-1.5 md:max-2xl:text-xs"
      aria-label={`${count} today`}
    >
      {count}
    </span>
  ) : null;
}

export interface ToolbarProps {
  phone: boolean;
  location: StaffLocationContext;
  options: StaffLocationOption[];
  now: Date;
  accepting: boolean;
  onlineOrderingEnabled: boolean;
  summary: QueueSummary;
  pausedUntil: string | null;
  pausing: boolean;
  onPause: (minutes: number | null) => Promise<void>;
  onResume: () => Promise<void>;
  cateringCount: number | undefined;
  onOpenPanel: (panel: StaffPanel) => void;
  onShowShortcuts: () => void;
}

export function StaffToolbar(props: ToolbarProps) {
  return props.phone ? <PhoneToolbar {...props} /> : <WideToolbar {...props} />;
}

/** Only while the new-order sound is off: one tap turns it back on. Icon only on a phone. */
function MutedButton({ iconOnly = false }: { iconOnly?: boolean }) {
  const sound = useSoundSettings();
  if (!sound.muted) return null;
  return (
    <button
      type="button"
      onClick={() => {
        unlockAudio();
        sound.setMuted(false);
      }}
      aria-label={iconOnly ? "Muted. Turn the sound on" : undefined}
      className={cn(TOOL_BUTTON, "border-2 border-staff-late/60 text-staff-late", iconOnly && "w-14 justify-center px-0")}
    >
      <VolumeX className="size-5" aria-hidden="true" />
      {iconOnly ? null : "Muted"}
    </button>
  );
}

function WideToolbar({
  location,
  options,
  now,
  accepting,
  onlineOrderingEnabled,
  summary,
  pausedUntil,
  pausing,
  onPause,
  onResume,
  cateringCount,
  onOpenPanel,
  onShowShortcuts,
}: ToolbarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-staff-line bg-staff-card px-4 py-2 lg:flex-nowrap xl:gap-x-5">
      <div className="min-w-0 flex-1 lg:flex-initial">
        <LocationHeading
          location={location}
          options={options}
          now={now}
          accepting={accepting}
          onlineOrderingEnabled={onlineOrderingEnabled}
          stacked
        />
      </div>
      <div className="flex shrink-0 items-center gap-3 lg:mx-auto xl:gap-5">
        <Clock now={now} />
        <span aria-hidden="true" className="h-10 w-px bg-staff-line" />
        <Stats summary={summary} />
      </div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1 lg:ml-0 lg:shrink-0 lg:flex-nowrap">
        <MutedButton />
        <PauseButton
          paused={!accepting}
          pausedUntil={pausedUntil}
          now={now}
          busy={pausing}
          onPause={onPause}
          onResume={onResume}
        />
        <button type="button" onClick={() => onOpenPanel("sold-out")} className={cn(TOOL_BUTTON, STACKED)}>
          <PackageX className="size-5" aria-hidden="true" />
          Sold out
        </button>
        <button type="button" onClick={() => onOpenPanel("catering")} className={cn(TOOL_BUTTON, STACKED, "relative")}>
          <ChefHat className="size-5" aria-hidden="true" />
          Catering
          <CateringBadge count={cateringCount} />
        </button>
        <button type="button" onClick={() => onOpenPanel("completed")} className={cn(TOOL_BUTTON, STACKED)}>
          <ClipboardList className="size-5" aria-hidden="true" />
          Completed
        </button>
        <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
          <PopoverTrigger className={cn(TOOL_BUTTON, STACKED, "min-w-14 justify-center px-0 md:max-2xl:px-2")}>
            <Settings className="size-6" aria-hidden="true" />
            <span className="sr-only md:max-2xl:not-sr-only">Settings</span>
          </PopoverTrigger>
          <PopoverContent align="end" sideOffset={8} className="w-[22rem] max-w-[calc(100vw-2rem)] p-4" aria-label="Settings">
            <DisplaySettings
              onShowShortcuts={() => {
                setSettingsOpen(false);
                onShowShortcuts();
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
    </header>
  );
}

function PhoneToolbar({
  location,
  options,
  now,
  accepting,
  onlineOrderingEnabled,
  summary,
  pausedUntil,
  pausing,
  onPause,
  onResume,
  cateringCount,
  onOpenPanel,
}: ToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const hoursLocation = {
    id: location.id,
    type: location.type,
    acceptingOrders: accepting,
    startsAt: location.startsAt,
    endsAt: location.endsAt,
  };
  const open = (panel: StaffPanel) => {
    setMenuOpen(false);
    onOpenPanel(panel);
  };
  return (
    <header className="flex items-center gap-2 rounded-2xl border border-staff-line bg-staff-card py-1.5 pr-1.5 pl-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <LocationHeading
          location={location}
          options={options}
          now={now}
          accepting={accepting}
          onlineOrderingEnabled={onlineOrderingEnabled}
          size="small"
          showHours={false}
        />
        <Clock now={now} small />
      </div>
      <MutedButton iconOnly />
      <PauseButton
        paused={!accepting}
        pausedUntil={pausedUntil}
        now={now}
        busy={pausing}
        variant="phone"
        onPause={onPause}
        onResume={onResume}
      />
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className={cn(TOOL_BUTTON, "relative w-14 justify-center px-0")}
          aria-label="Menu"
        >
          <Menu className="size-6" aria-hidden="true" />
          {cateringCount ? <span aria-hidden="true" className="absolute top-2 right-2 size-2.5 rounded-full bg-staff-fill-new" /> : null}
        </button>
        <SheetContent
          side="bottom"
          className="max-h-[90dvh] gap-0 overflow-y-auto rounded-t-3xl p-0 [&_[data-slot=sheet-close]]:size-14 [&_[data-slot=sheet-close]_svg]:size-7"
        >
          <SheetHeader className="border-b p-4 pr-20">
            <SheetTitle className="font-heading text-2xl font-extrabold">{location.name}</SheetTitle>
            <SheetDescription className="text-base" data-testid="todays-hours">
              Today: {todaysHoursText({ location: hoursLocation, hours: location.hours, closures: location.closures, now }).hours}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-5 p-4">
            <Stats summary={summary} tiles />
            <div className="grid gap-2">
              <button type="button" onClick={() => open("sold-out")} className={TOOL_BUTTON}>
                <PackageX className="size-5" aria-hidden="true" />
                Sold out
              </button>
              <button type="button" onClick={() => open("catering")} className={TOOL_BUTTON}>
                <ChefHat className="size-5" aria-hidden="true" />
                Catering
                <CateringBadge count={cateringCount} />
              </button>
              <button type="button" onClick={() => open("completed")} className={TOOL_BUTTON}>
                <ClipboardList className="size-5" aria-hidden="true" />
                Completed
              </button>
            </div>
            <DisplaySettings />
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
