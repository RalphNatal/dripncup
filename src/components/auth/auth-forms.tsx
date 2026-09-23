"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  CheckboxField,
  FormAlert,
  PasswordField,
  SubmitButton,
  TextField,
  formKey,
} from "@/components/auth/form-fields";
import { FieldGroup } from "@/components/ui/field";
import {
  requestPasswordReset,
  signIn,
  signUp,
  updatePassword,
} from "@/lib/auth/actions";
import { IDLE } from "@/lib/auth/form-state";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/schemas";

export function SignInForm({ next }: { next: string }) {
  const [state, action] = useActionState(signIn, IDLE);
  const errors = state.fieldErrors ?? {};

  return (
    <form key={formKey(state)} action={action} noValidate className="space-y-5">
      <input type="hidden" name="next" value={next} />
      <FieldGroup className="gap-4">
        <TextField
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={state.values?.email}
          error={errors.email}
        />
        <PasswordField
          name="password"
          label="Password"
          autoComplete="current-password"
          required
          error={errors.password}
        />
      </FieldGroup>

      <div className="flex justify-end">
        <Link
          href="/forgot-password"
          className="text-sm font-medium text-brand-teal-deep underline-offset-4 hover:underline"
        >
          Forgot password?
        </Link>
      </div>

      <FormAlert state={state} />
      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}

export function SignUpForm({ next }: { next: string }) {
  const [state, action] = useActionState(signUp, IDLE);
  const errors = state.fieldErrors ?? {};

  // Confirmation email sent: the form has done its job.
  if (state.status === "success") {
    return <FormAlert state={state} />;
  }

  return (
    <form key={formKey(state)} action={action} noValidate className="space-y-5">
      <input type="hidden" name="next" value={next} />
      <FieldGroup className="gap-4">
        <TextField
          name="fullName"
          label="Name"
          autoComplete="name"
          required
          maxLength={100}
          defaultValue={state.values?.fullName}
          error={errors.fullName}
          description="Your first name is what we call out when your order is ready."
        />
        <TextField
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={state.values?.email}
          error={errors.email}
        />
        <PasswordField
          name="password"
          label="Password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          error={errors.password}
          description={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        />
        <TextField
          name="phone"
          label="Phone (optional)"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          defaultValue={state.values?.phone}
          error={errors.phone}
        />
        <CheckboxField
          name="marketingOptIn"
          label="Email me about new drinks, events and offers"
          description="You can change this any time in your account."
          defaultChecked={state.values?.marketingOptIn === "on"}
        />
      </FieldGroup>

      <FormAlert state={state} />
      <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordReset, IDLE);
  const errors = state.fieldErrors ?? {};

  if (state.status === "success") {
    return <FormAlert state={state} />;
  }

  return (
    <form key={formKey(state)} action={action} noValidate className="space-y-5">
      <TextField
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        defaultValue={state.values?.email}
        error={errors.email}
      />
      <FormAlert state={state} />
      <SubmitButton pendingLabel="Sending…">Send reset link</SubmitButton>
    </form>
  );
}

export function NewPasswordForm() {
  const [state, action] = useActionState(updatePassword, IDLE);
  const errors = state.fieldErrors ?? {};

  if (state.status === "success") {
    return (
      <div className="space-y-4">
        <FormAlert state={state} />
        <Link
          href="/account"
          className="inline-block text-sm font-medium text-brand-teal-deep underline-offset-4 hover:underline"
        >
          Back to your account
        </Link>
      </div>
    );
  }

  return (
    <form action={action} noValidate className="space-y-5">
      <FieldGroup className="gap-4">
        <PasswordField
          name="password"
          label="New password"
          autoComplete="new-password"
          required
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          error={errors.password}
          description={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        />
        <PasswordField
          name="confirmPassword"
          label="Confirm new password"
          autoComplete="new-password"
          required
          error={errors.confirmPassword}
        />
      </FieldGroup>
      <FormAlert state={state} />
      <SubmitButton pendingLabel="Saving…">Update password</SubmitButton>
    </form>
  );
}
