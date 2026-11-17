// An active vendor account as the bill form lists it: backend
// VendorAccountOption, from GET /vendor-accounts.
export type VendorAccountOption = {
  id: string;
  account_number: string;
  vendor_id: string;
  vendor_name: string;
  property_id: string;
  property_name: string;
};
