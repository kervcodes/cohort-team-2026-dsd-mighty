import { z } from "zod";

export const accountStatuses = ["", "paid", "unpaid", "outstanding"] as const;

const money = /^\d{1,10}(\.\d{1,2})?$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export const invoiceFormSchema = z
  .object({
    accountNumber: z.string().trim(),
    statementId: z.string().trim(),
    companyName: z.string().trim(),
    propertyAddress: z.string().trim(),
    issueDate: z.string(),
    dueDate: z.string(),
    description: z.string().trim(),
    previousPayments: z
      .string()
      .trim()
      .refine((v) => v === "" || money.test(v), "Enter an amount like 1180.50"),
    currentDue: z
      .string()
      .trim()
      .regex(money, "Enter an amount like 1180.50")
      .refine((v) => Number(v) > 0, "Amount must be greater than 0"),
    accountStatus: z.enum(accountStatuses),
    notes: z.string().trim(),
    websiteName: z
      .string()
      .trim()
      .refine((v) => {
        if (v === "") return true;
        try {
          const { protocol } = new URL(v);
          return protocol === "http:" || protocol === "https:";
        } catch {
          return false;
        }
      }, "Enter a full URL like https://domainname.com"),
  })
  .refine((v) => v.dueDate >= v.issueDate, {
    message: "Due date can't be before the issue date",
    path: ["dueDate"],
  });

export type InvoiceFormValues = z.infer<typeof invoiceFormSchema>;

export const emptyInvoiceForm: InvoiceFormValues = {
  accountNumber: "",
  statementId: "",
  companyName: "",
  propertyAddress: "",
  issueDate: "",
  dueDate: "",
  description: "",
  previousPayments: "",
  currentDue: "",
  accountStatus: "",
  notes: "",
  websiteName: "",
};
