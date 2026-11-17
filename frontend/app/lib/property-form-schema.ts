import { z } from "zod";
import type { PropertyCreatePayload } from "@/lib/api/properties";

// Limits mirror backend/src/backend/schemas/property.py (and the properties
// table checks) so the user sees the error inline instead of as a 422.
export const propertyFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Property name is required")
    .max(200, "Use 200 characters or fewer"),
  street: z.string().trim().min(1, "Street is required").max(200, "Use 200 characters or fewer"),
  city: z.string().trim().min(1, "City is required").max(100, "Use 100 characters or fewer"),
  state: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "Use the 2-letter state code")
    .transform((state) => state.toUpperCase()),
  zipCode: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, "Use a 5-digit ZIP code, or ZIP+4"),
});

export type PropertyFormInput = z.input<typeof propertyFormSchema>;
export type PropertyFormValues = z.output<typeof propertyFormSchema>;

export const propertyDefaults: PropertyFormInput = {
  name: "",
  street: "",
  city: "",
  state: "",
  zipCode: "",
};

export function toPropertyPayload(values: PropertyFormValues): PropertyCreatePayload {
  return {
    property_name: values.name,
    address: {
      street: values.street,
      city: values.city,
      state: values.state,
      zip_code: values.zipCode,
    },
  };
}
