import { z } from "zod";
import { type PaymentMethod, paymentMethods, type VendorCreatePayload } from "@/lib/api/vendors";

// Limits mirror backend/src/backend/schemas/vendor.py so the user sees the
// error inline instead of as a 422 from the API.
export const vendorFormSchema = z.object({
  name: z.string().trim().min(1, "Vendor name is required").max(200, "Use 200 characters or fewer"),
  contactEmail: z
    .string()
    .trim()
    .refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email address"),
  contactPhone: z.string().trim().max(30, "Use 30 characters or fewer"),
  paymentMethod: z.enum(["", ...paymentMethods]),
});

export type VendorFormValues = z.infer<typeof vendorFormSchema>;

export const vendorDefaults: VendorFormValues = {
  name: "",
  contactEmail: "",
  contactPhone: "",
  paymentMethod: "",
};

// Empty optional fields are left out of the payload, not sent as "".
export function toVendorPayload(values: VendorFormValues): VendorCreatePayload {
  const payload: VendorCreatePayload = { name: values.name };
  if (values.contactEmail) payload.contact_email = values.contactEmail;
  if (values.contactPhone) payload.contact_phone = values.contactPhone;
  if (values.paymentMethod) payload.default_payment_method = values.paymentMethod as PaymentMethod;
  return payload;
}
