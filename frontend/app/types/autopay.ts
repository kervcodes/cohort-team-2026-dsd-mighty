// Mirrors backend/src/backend/schemas/autopay.py (DC-86).

// The one autopay setting. `limit_amount` is a decimal string, kept while
// autopay is off; never null while it is on.
export type AutopaySettings = {
  enabled: boolean;
  limit_amount: string | null;
  // The admin who last changed it, and their current name; null until then.
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string;
};

// `PUT /autopay-settings`: both fields, every time.
export type AutopaySettingsUpdate = {
  enabled: boolean;
  limit_amount: string | null;
};
