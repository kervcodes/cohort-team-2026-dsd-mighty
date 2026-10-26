import { z } from 'zod';

export const accountStatuses = ['paid', 'unpaid', 'outstanding'];

const money = /^\d+(\.\d{1,2})?$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export const invoiceFormSchema = z
  .object({
    accountNumber: z.string().trim().min(1, 'Account / customer # is required'),
    statementId: z.string().trim().min(1, 'Statement # is required'),
    companyName: z
      .string()
      .trim()
      .min(1, 'Customer / business name is required'),
    propertyAddress: z.string().trim().min(1, 'Property address is required'),
    issueDate: z.string().regex(isoDate, 'Issue date is required'),
    dueDate: z.string().regex(isoDate, 'Due date is required'),
    description: z.string().min(1, 'Add a short description'),
    previousPayments: z
      .string()
      .trim()
      .refine((v) => v === '' || money.test(v), 'Enter an amount like 1180.50'),
    currentDue: z.string().trim().regex(money, 'Enter an amount like 1180.50'),
    accountStatus: z.enum(accountStatuses),
    notes: z.string().trim(),
    websiteName: z
      .string()
      .trim()
      .refine((v) => {
        if (v === '') return true;
        try {
          new URL(v);
          return true;
        } catch {
          return false;
        }
      }, 'Enter a full URL like https://domainname.com'),
  })
  .refine((v) => v.dueDate >= v.issueDate, {
    message: "Due date can't be before the issue date",
    path: ['dueDate'],
  });

export type InvoiceFormValues = z.infer<typeof invoiceFormSchema>;

export const emptyInvoiceForm: InvoiceFormValues = {
  accountNumber: '',
  statementId: '',
  companyName: '',
  propertyAddress: '',
  issueDate: '',
  dueDate: '',
  description: '',
  previousPayments: '',
  currentDue: '',
  accountStatus: '',
  notes: '',
  websiteName: '',
};
