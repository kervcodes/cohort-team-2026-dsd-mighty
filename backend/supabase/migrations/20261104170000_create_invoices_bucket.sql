-- 1. INVOICES BUCKET

-- Private bucket for uploaded invoice PDFs
-- (backend/src/backend/services/bill_storage.py, BUCKET_NAME).
-- It was first created by hand in the dashboard; this makes every environment
-- match. Re-running it, or running it where the bucket exists, keeps the
-- bucket private.

insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do update set public = false;

-- Size and type limits. These columns are added by the Storage service's own
-- migrations, so a database started without Storage (CI runs
-- `supabase db start`) may not have them yet; set them where they exist.

do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'storage'
            and table_name = 'buckets'
            and column_name = 'file_size_limit'
    ) then
        -- Matches MAX_FILE_SIZE in bill_storage.py (10 MiB).
        update storage.buckets
        set file_size_limit = 10485760
        where id = 'invoices';
    end if;

    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'storage'
            and table_name = 'buckets'
            and column_name = 'allowed_mime_types'
    ) then
        update storage.buckets
        set allowed_mime_types = array['application/pdf']
        where id = 'invoices';
    end if;
end;
$$;

-- 2. ACCESS

-- No storage policies, on purpose. Only the backend reads and writes invoice
-- files, with the service-role key, which bypasses row-level security. With
-- RLS on storage.objects and no policy for this bucket, the anon and
-- authenticated roles (the browser's Supabase client) can neither list,
-- download nor upload invoice files.
-- backend/supabase/tests/invoices_bucket.test.sql checks this.
