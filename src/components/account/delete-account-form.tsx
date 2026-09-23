"use client";

import { useActionState } from "react";

import { FormAlert, PasswordField, SubmitButton, TextField, formKey } from "@/components/auth/form-fields";
import { FieldGroup } from "@/components/ui/field";
import { deleteAccount } from "@/app/account/actions";
import { IDLE } from "@/lib/auth/form-state";
import { DELETE_CONFIRMATION } from "@/lib/auth/schemas";

/** Password re-entry plus typing DELETE. On success the action redirects home. */
export function DeleteAccountForm() {
  const [state, action] = useActionState(deleteAccount, IDLE);
  const errors = state.fieldErrors ?? {};

  return (
    <form key={formKey(state)} action={action} noValidate className="space-y-5">
      <FieldGroup className="gap-4">
        <PasswordField
          name="password"
          label="Your password"
          autoComplete="current-password"
          required
          error={errors.password}
        />
        <TextField
          name="confirmation"
          label={`Type ${DELETE_CONFIRMATION} to confirm`}
          required
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          defaultValue={state.values?.confirmation}
          error={errors.confirmation}
        />
      </FieldGroup>

      <FormAlert state={state} />
      <SubmitButton tone="danger" pendingLabel="Deleting your account…">
        Delete my account
      </SubmitButton>
    </form>
  );
}
