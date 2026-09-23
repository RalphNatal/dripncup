"use client";

/**
 * Small building blocks shared by the auth and account forms. They are plain
 * uncontrolled inputs, so every form works before JavaScript loads and posts
 * straight to its Server Action.
 */
import { CircleAlert, CircleCheck, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { FormState } from "@/lib/auth/form-state";
import { cn } from "@/lib/utils";

type TextFieldProps = Omit<ComponentProps<typeof Input>, "id"> & {
  name: string;
  label: string;
  error?: string;
  description?: ReactNode;
  /** Rendered inside the input's right edge, e.g. a show-password toggle. */
  endSlot?: ReactNode;
};

export function TextField({
  name,
  label,
  error,
  description,
  endSlot,
  className,
  ...input
}: TextFieldProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <Input
          id={id}
          name={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={[descriptionId, errorId].filter(Boolean).join(" ") || undefined}
          className={cn("h-11 rounded-xl px-3", endSlot && "pr-12", className)}
          {...input}
        />
        {endSlot ? (
          <div className="absolute inset-y-0 right-0.5 flex items-center">{endSlot}</div>
        ) : null}
      </div>
      {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  );
}

/** Password input with a show/hide toggle; typing on a phone is error-prone. */
export function PasswordField(props: Omit<TextFieldProps, "type" | "endSlot">) {
  const [visible, setVisible] = useState(false);

  return (
    <TextField
      {...props}
      type={visible ? "text" : "password"}
      endSlot={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="size-10 rounded-lg text-muted-foreground"
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      }
    />
  );
}

export function CheckboxField({
  name,
  label,
  description,
  defaultChecked,
  error,
}: {
  name: string;
  label: string;
  description?: ReactNode;
  defaultChecked?: boolean;
  error?: string;
}) {
  const id = useId();

  return (
    <Field orientation="horizontal" data-invalid={error ? true : undefined}>
      <Checkbox
        id={id}
        name={name}
        defaultChecked={defaultChecked}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : description ? `${id}-description` : undefined}
      />
      <FieldContent>
        <FieldLabel htmlFor={id} className="font-normal">
          {label}
        </FieldLabel>
        {description ? (
          <FieldDescription id={`${id}-description`}>{description}</FieldDescription>
        ) : null}
        {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
      </FieldContent>
    </Field>
  );
}

export function SubmitButton({ children, pendingLabel }: { children: ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      disabled={pending}
      aria-disabled={pending}
      className="h-12 w-full rounded-full bg-brand-teal-deep text-base font-semibold text-white hover:bg-brand-teal-deep/90"
    >
      {pending ? (
        <>
          <LoaderCircle className="animate-spin" aria-hidden="true" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

/** The form-level result, announced to screen readers when it appears. */
export function FormAlert({ state }: { state: FormState }) {
  if (!state.message) return null;
  const isError = state.status === "error";

  return (
    <Alert
      variant={isError ? "destructive" : "default"}
      className={cn("rounded-xl px-3 py-2.5", !isError && "border-brand-teal/40 bg-brand-teal-soft")}
    >
      {isError ? <CircleAlert aria-hidden="true" /> : <CircleCheck aria-hidden="true" />}
      <AlertDescription className={cn(!isError && "text-foreground")}>{state.message}</AlertDescription>
    </Alert>
  );
}

/**
 * React resets a form after its action finishes. Keying the form on what the
 * server echoed back remounts it with those values as the new defaults, so a
 * validation error never wipes what the visitor typed.
 */
export function formKey(state: FormState): string {
  return state.values ? JSON.stringify(state.values) : "initial";
}
