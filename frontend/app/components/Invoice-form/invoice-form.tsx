"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { FormField, inputClass } from "@/components/Form-field/form-field";
import Button from "@/components/ui/button";
import { invoicesNew } from "@/content";
import type { BillCreatePayload } from "@/lib/api/bills";
import { createBill } from "@/lib/api/bills";
import {
  accountStatuses,
  emptyInvoiceForm,
  type InvoiceFormValues,
  invoiceFormSchema,
} from "@/lib/invoice-form-schema";

export function InvoiceForm() {
  const router = useRouter();
  const [submitError, setSubmitError] = useState("");

  const {
    register,
    handleSubmit,

    formState: { errors, isSubmitting },
  } = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: emptyInvoiceForm,
  });

  async function onSubmit(values: InvoiceFormValues) {
    setSubmitError("");

    const payload: BillCreatePayload = {
      account_number_raw: values.accountNumber.trim(),
      invoice_number: values.statementId.trim(),
      vendor_name_raw: values.companyName.trim() || undefined,
      invoice_date: values.issueDate,
      due_date: values.dueDate,
      amount: values.currentDue.trim(),
      prev_payments: values.previousPayments.trim() || undefined,
      description: values.description.trim() || undefined,
      processing_notes: values.notes.trim() || undefined,
      property_address: values.propertyAddress,
      account_status: values.accountStatus || undefined,
      website_name: values.websiteName || undefined,
    };

    try {
      await createBill(payload);

      router.push("/dashboard");
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Unable to create the bill. Please try again.",
      );
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="mx-auto max-w-3xl space-y-6">
      {submitError && (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {submitError}
        </p>
      )}
      <div className="flex items-center justify-between gap-4">
        <h1
          data-content="invoices-new.heading"
          className="text-3xl font-semibold tracking-tight text-foreground"
        >
          {invoicesNew.heading}
        </h1>

        <div className="flex items-center gap-3">
          <Button
            label={invoicesNew.actions.save}
            data-content="invoices-new.actions.save"
            type="button"
          />
          <Button
            label={invoicesNew.actions.cancel}
            data-content="invoices-new.actions.cancel"
            variant="secondary"
            onClick={() => router.push("/dashboard")}
            type="button"
          />
        </div>
      </div>

      <section className="rounded-xl border border-dashed border-border bg-surface p-6 text-center">
        <FileUp className="mx-auto h-6 w-6 text-foreground-muted" />
        <p
          data-content="invoices-new.upload.title"
          className="mt-2 text-sm font-medium text-foreground"
        >
          {invoicesNew.upload.title}
        </p>
        <p data-content="invoices-new.upload.status" className="text-xs text-foreground-muted">
          {invoicesNew.upload.status}
        </p>
      </section>

      <fieldset className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
        <legend
          data-content="invoices-new.general.legend"
          className="px-2 text-sm font-semibold text-foreground"
        >
          {invoicesNew.general.legend}
        </legend>

        <FormField
          label={invoicesNew.general.accountNumber}
          contentKey="invoices-new.general.accountNumber"
          htmlFor="accountNumber"
          error={errors.accountNumber?.message}
        >
          {(field) => <input {...field} {...register("accountNumber")} className={inputClass} />}
        </FormField>

        <FormField
          label={invoicesNew.general.statementId}
          contentKey="invoices-new.general.statementId"
          htmlFor="statementId"
          error={errors.statementId?.message}
        >
          {(field) => <input {...field} {...register("statementId")} className={inputClass} />}
        </FormField>

        <FormField
          label={invoicesNew.general.companyName}
          contentKey="invoices-new.general.companyName"
          htmlFor="companyName"
          error={errors.companyName?.message}
        >
          {(field) => <input {...field} {...register("companyName")} className={inputClass} />}
        </FormField>

        <FormField
          label={invoicesNew.general.propertyAddress}
          contentKey="invoices-new.general.propertyAddress"
          htmlFor="propertyAddress"
          error={errors.propertyAddress?.message}
        >
          {(field) => (
            <input
              {...field}
              {...register("propertyAddress")}
              placeholder={invoicesNew.general.propertyAddressPlaceholder}
              data-content="invoices-new.general.propertyAddressPlaceholder"
              className={inputClass}
            />
          )}
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={invoicesNew.general.issueDate}
            contentKey="invoices-new.general.issueDate"
            htmlFor="issueDate"
            error={errors.issueDate?.message}
          >
            {(field) => (
              <input {...field} type="date" {...register("issueDate")} className={inputClass} />
            )}
          </FormField>

          <FormField
            label={invoicesNew.general.dueDate}
            contentKey="invoices-new.general.dueDate"
            htmlFor="dueDate"
            error={errors.dueDate?.message}
          >
            {(field) => (
              <input {...field} type="date" {...register("dueDate")} className={inputClass} />
            )}
          </FormField>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
        <legend
          data-content="invoices-new.payment.legend"
          className="px-2 text-sm font-semibold text-foreground"
        >
          {invoicesNew.payment.legend}
        </legend>

        <FormField
          label={invoicesNew.payment.description}
          contentKey="invoices-new.payment.description"
          htmlFor="description"
          error={errors.description?.message}
        >
          {(field) => (
            <input
              {...field}
              {...register("description")}
              placeholder={invoicesNew.payment.descriptionPlaceholder}
              data-content="invoices-new.payment.descriptionPlaceholder"
              className={inputClass}
            />
          )}
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={invoicesNew.payment.previousPayments}
            contentKey="invoices-new.payment.previousPayments"
            htmlFor="previousPayments"
            error={errors.previousPayments?.message}
          >
            {(field) => (
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-muted">
                  {invoicesNew.payment.currencySymbol}
                </span>
                <input
                  {...field}
                  {...register("previousPayments")}
                  inputMode="decimal"
                  placeholder="0.00"
                  className={`${inputClass} pl-7 tabular-nums`}
                />
              </div>
            )}
          </FormField>

          <FormField
            label={invoicesNew.payment.currentDue}
            contentKey="invoices-new.payment.currentDue"
            htmlFor="currentDue"
            error={errors.currentDue?.message}
          >
            {(field) => (
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-muted">
                  {invoicesNew.payment.currencySymbol}
                </span>
                <input
                  {...field}
                  {...register("currentDue")}
                  inputMode="decimal"
                  placeholder="0.00"
                  className={`${inputClass} pl-7 tabular-nums`}
                />
              </div>
            )}
          </FormField>
        </div>

        <FormField
          label={invoicesNew.payment.accountStatus}
          contentKey="invoices-new.payment.accountStatus"
          htmlFor="accountStatus"
          error={errors.accountStatus?.message}
        >
          {(field) => (
            <select
              {...field}
              {...register("accountStatus")}
              className={`${inputClass} capitalize`}
            >
              {accountStatuses.map((status) => (
                <option key={status} value={status}>
                  {status || invoicesNew.payment.selectStatus}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <FormField
          label={invoicesNew.payment.notes}
          contentKey="invoices-new.payment.notes"
          htmlFor="notes"
          error={errors.notes?.message}
        >
          {(field) => (
            <textarea {...field} {...register("notes")} rows={4} className={inputClass} />
          )}
        </FormField>

        <FormField
          label={invoicesNew.payment.websiteName}
          contentKey="invoices-new.payment.websiteName"
          htmlFor="websiteName"
          error={errors.websiteName?.message}
        >
          {(field) => (
            <input
              {...field}
              {...register("websiteName")}
              placeholder={invoicesNew.payment.websiteNamePlaceholder}
              data-content="invoices-new.payment.websiteNamePlaceholder"
              className={inputClass}
            />
          )}
        </FormField>
      </fieldset>

      <Button
        label={isSubmitting ? invoicesNew.submit.creating : invoicesNew.submit.create}
        data-content="invoices-new.submit.create"
        type="submit"
        disabled={isSubmitting}
        className="w-full border-2"
      />
    </form>
  );
}
