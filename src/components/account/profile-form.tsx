"use client";

import { useActionState } from "react";

import {
  CheckboxField,
  FormAlert,
  SubmitButton,
  TextField,
  formKey,
} from "@/components/auth/form-fields";
import { FieldGroup, FieldLegend, FieldSet } from "@/components/ui/field";
import { updateProfile } from "@/app/(shop)/account/actions";
import { IDLE } from "@/lib/auth/form-state";

export type ProfileFormDefaults = {
  fullName: string;
  firstName: string;
  phone: string;
  marketingOptIn: boolean;
  smsOptIn: boolean;
  orderReadyEmail: boolean;
};

export function ProfileForm({ defaults }: { defaults: ProfileFormDefaults }) {
  const [state, action] = useActionState(updateProfile, IDLE);
  const errors = state.fieldErrors ?? {};

  // After a submit, show what was sent back; before one, the saved profile.
  const echoed = state.values;
  const text = (key: "fullName" | "firstName" | "phone") => echoed?.[key] ?? defaults[key];
  const checked = (key: "marketingOptIn" | "smsOptIn" | "orderReadyEmail") =>
    echoed ? echoed[key] === "on" : defaults[key];

  return (
    <form key={formKey(state)} action={action} noValidate className="space-y-6">
      <FieldSet>
        <FieldLegend>Your details</FieldLegend>
        <FieldGroup className="gap-4">
          <TextField
            name="fullName"
            label="Name"
            autoComplete="name"
            required
            maxLength={100}
            defaultValue={text("fullName")}
            error={errors.fullName}
          />
          <TextField
            name="firstName"
            label="Name for your cup"
            autoComplete="given-name"
            maxLength={30}
            defaultValue={text("firstName")}
            error={errors.firstName}
            description="What the barista calls out. Leave blank to use your first name."
          />
          <TextField
            name="phone"
            label="Phone (optional)"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            defaultValue={text("phone")}
            error={errors.phone}
          />
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Notifications</FieldLegend>
        <FieldGroup className="gap-4">
          <CheckboxField
            name="orderReadyEmail"
            label="Email me when my order is ready"
            description="Off by default: the order page alerts you in the app. Receipts and refunds are always emailed."
            defaultChecked={checked("orderReadyEmail")}
          />
          <CheckboxField
            name="marketingOptIn"
            label="Email me about new drinks, events and offers"
            defaultChecked={checked("marketingOptIn")}
          />
          <CheckboxField
            name="smsOptIn"
            label="Text me about offers"
            description="Needs a phone number. Message and data rates may apply."
            defaultChecked={checked("smsOptIn")}
            error={errors.smsOptIn}
          />
        </FieldGroup>
      </FieldSet>

      <FormAlert state={state} />
      <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
    </form>
  );
}
