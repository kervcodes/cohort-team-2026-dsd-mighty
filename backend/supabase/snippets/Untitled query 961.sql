select column_name from information_schema.columns
where table_name = 'bills' and column_name in ('vendor_account_picked', 'property_address_mismatch');