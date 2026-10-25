'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FileUp } from 'lucide-react';
import Button from '@/app/components/Button';
import { FormField, inputClass } from '@/app/components/Form-field/form-field';
import {
  accountStatuses,
  emptyInvoiceForm,
  invoiceFormSchema,
  type InvoiceFormValues,
} from '@/app/lib/invoice-form-schema';

const DRAFT_KEY = 'invoice-draft';

export function InvoiceForm() {
  const router = useRouter();
  const [draftMessage, setDraftMessage] = useState('');

  const {
    register,
    handleSubmit,
    getValues,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<InvoiceFormValues>({
    resolver: zodResolver(invoiceFormSchema),
    defaultValues: emptyInvoiceForm,
  });

  async function onSubmit(values: InvoiceFormValues) {
    // TODO: POST to FastAPI. Mapping to the table's Invoice type:

    console.log('Create invoice', values);

    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
    router.push('/dashboard');
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="mx-auto max-w-3xl space-y-6"
    >
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          New Invoice
        </h1>

        <div className="flex items-center gap-3">
          <p role="status" className="text-sm text-foreground-muted">
            {draftMessage}
          </p>
          <Button label="Save" />
          <Button
            label="Cancel"
            variant="secondary"
            onClick={() => router.push('/dashboard')}
          />
        </div>
      </div>

      <section className="rounded-xl border border-dashed border-border bg-surface p-6 text-center">
        <FileUp className="mx-auto h-6 w-6 text-foreground-muted" />
        <p className="mt-2 text-sm font-medium text-foreground">
          Upload / import invoice (PDF)
        </p>
        <p className="text-xs text-foreground-muted">Coming soon</p>
      </section>

      <fieldset className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
        <legend className="px-2 text-sm font-semibold text-foreground">
          General bill info
        </legend>

        <FormField
          label="Account / Customer #"
          htmlFor="accountNumber"
          error={errors.accountNumber?.message}
        >
          <input {...register('accountNumber')} className={inputClass} />
        </FormField>

        <FormField
          label="Statement / Bill ID"
          htmlFor="statementId"
          error={errors.statementId?.message}
        >
          <input {...register('statementId')} className={inputClass} />
        </FormField>

        <FormField
          label="Customer / Business Name"
          htmlFor="companyName"
          error={errors.companyName?.message}
        >
          <input {...register('companyName')} className={inputClass} />
        </FormField>

        <FormField
          label="Property Address"
          htmlFor="propertyAddress"
          error={errors.propertyAddress?.message}
        >
          <input
            {...register('propertyAddress')}
            placeholder="Enter property address"
            className={inputClass}
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Issue / Record / Invoice Date"
            htmlFor="issueDate"
            error={errors.issueDate?.message}
          >
            <input
              type="date"
              {...register('issueDate')}
              className={inputClass}
            />
          </FormField>

          <FormField
            label="Due / Pay Date"
            htmlFor="dueDate"

            error={errors.dueDate?.message}
          >
            <input
              type="date"
              {...register('dueDate')}
              className={inputClass}
            />
          </FormField>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-sm">
        <legend className="px-2 text-sm font-semibold text-foreground">
          Payment info
        </legend>

        <FormField
          label="Bill Description / Explanation"
          htmlFor="description"
          error={errors.description?.message}
        >
          <input
            {...register('description')}
            placeholder="e.g. Utility, rent"
            className={inputClass}
          />
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Prev Payments"
            htmlFor="previousPayments"
            error={errors.previousPayments?.message}
          >
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-muted">
                $
              </span>
              <input
                {...register('previousPayments')}
                inputMode="decimal"
                placeholder="0.00"
                className={`${inputClass} pl-7 tabular-nums`}
              />
            </div>
          </FormField>

          <FormField
            label="Current Due"
            htmlFor="currentDue"
            error={errors.currentDue?.message}
          >
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-foreground-muted">
                $
              </span>
              <input
                {...register('currentDue')}
                inputMode="decimal"
                placeholder="0.00"
                className={`${inputClass} pl-7 tabular-nums`}
              />
            </div>
          </FormField>
        </div>

        <FormField
          label="Account Status"
          htmlFor="accountStatus"
          error={errors.accountStatus?.message}
        >
          <select
            {...register('accountStatus')}
            className={`${inputClass} capitalize`}
          >
            {accountStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </FormField>

        <FormField
          label="Payment / Processing Notes (optional)"
          htmlFor="notes"
          error={errors.notes?.message}
        >
          <textarea {...register('notes')} rows={4} className={inputClass} />
        </FormField>

        <FormField
          label="Website Name (optional)"
          htmlFor="websiteName"
          error={errors.websiteName?.message}
        >
          <input
            {...register('websiteName')}
            placeholder="https://domainname.com"
            className={inputClass}
          />
        </FormField>
      </fieldset>

      <Button
        label={isSubmitting ? 'Creating…' : 'Create'}
        type="submit"
        disabled={isSubmitting}
        className="w-full border-2"
      />
    </form>
  );
}
