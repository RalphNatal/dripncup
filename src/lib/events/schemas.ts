/**
 * The admin event form. One row is one day: a date, a start time and an end
 * time in Honolulu; an end earlier than the start runs past midnight (a
 * night market), still within the 24-hour limit.
 */
import { z } from "zod";

import { cafeInstant } from "@/lib/time";

import { EVENT_WINDOW_MESSAGES, eventWindowProblem } from "./window";

const text = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, { error: `${label} must be ${max} characters or fewer.` });

const coordinate = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || (/^-?\d{1,3}(\.\d{1,6})?$/.test(v) && Number(v) >= min && Number(v) <= max), {
      error: `Enter a ${label} between ${min} and ${max}, up to 6 decimals.`,
    });

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const eventFormSchema = z
  .object({
    id: z.guid().nullable(),
    name: text(80, "The name").min(2, { error: "Give the event a name." }),
    /** Empty = made from the name and date. */
    slug: text(80, "The web address").refine((v) => v === "" || SLUG_PATTERN.test(v), {
      error: "Use lowercase letters, numbers and single hyphens.",
    }),
    description: text(1000, "The description"),
    addressLine1: text(120, "The address"),
    addressLine2: text(120, "The second address line"),
    city: text(60, "The city"),
    postalCode: text(10, "The ZIP code").refine((v) => v === "" || /^\d{5}$/.test(v), { error: "Enter a 5-digit ZIP code." }),
    mapUrl: text(500, "The map link").refine((v) => v === "" || /^https:\/\/\S+$/.test(v), {
      error: "Paste a full https:// link from Google Maps or Apple Maps.",
    }),
    latitude: coordinate(-90, 90, "latitude"),
    longitude: coordinate(-180, 180, "longitude"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "Pick a date." }),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Pick a start time." }),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: "Pick an end time." }),
    prepTimeMinutes: z.coerce.number().int().min(0, { error: "0 or more." }).max(240, { error: "At most 240 minutes." }),
    imagePath: z.string().max(200).nullable(),
    pickupInstructions: text(300, "The pickup instructions"),
    menu: z.array(z.guid()).max(100, { error: "At most 100 menu items." }),
    staff: z.array(z.guid()).max(50),
  })
  .superRefine((value, ctx) => {
    if (!value.addressLine1 && !value.mapUrl && !(value.latitude && value.longitude)) {
      ctx.addIssue({ code: "custom", path: ["addressLine1"], message: "Give an address, a map link or coordinates, so customers can find you." });
    }
    if ((value.latitude === "") !== (value.longitude === "")) {
      ctx.addIssue({ code: "custom", path: ["longitude"], message: "Enter both latitude and longitude, or neither." });
    }
    const window = eventWindow(value.date, value.startTime, value.endTime);
    const problem = eventWindowProblem(window?.startsAt ?? null, window?.endsAt ?? null);
    if (problem) ctx.addIssue({ code: "custom", path: ["endTime"], message: EVENT_WINDOW_MESSAGES[problem] });
  });

export type EventFormInput = z.input<typeof eventFormSchema>;

/** The window an event row covers; an end at or before the start is the next day. */
export function eventWindow(date: string, startTime: string, endTime: string): { startsAt: Date; endsAt: Date } | null {
  const startsAt = cafeInstant(date, startTime);
  const endSameDay = cafeInstant(date, endTime);
  if (!startsAt || !endSameDay) return null;
  const endsAt = endSameDay.getTime() > startsAt.getTime() ? endSameDay : new Date(endSameDay.getTime() + 24 * 60 * 60 * 1000);
  return { startsAt, endsAt };
}
