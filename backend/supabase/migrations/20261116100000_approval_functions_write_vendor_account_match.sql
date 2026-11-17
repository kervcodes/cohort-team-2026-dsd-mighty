-- The vendor account match (vendor_account_id, vendor_id, property_id,
-- vendor_account_picked) is worked out by the backend (vendor_account_matching)
-- and sent in p_fields. The three approval functions wrote only the invoice
-- fields, so a bill made through them would lose its match. They now write the
-- match too, in the same transaction as the bill and its approval.

CREATE OR REPLACE FUNCTION public.create_bill_with_approval(
    p_fields jsonb,
    p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
    v_bill public.bills%ROWTYPE;
    v_bill_id uuid;
BEGIN
    -- Convert the validated API payload into the database's typed row.
    v_bill := jsonb_populate_record(NULL::public.bills, p_fields);

    -- Create the submitted bill.
    INSERT INTO public.bills (
        account_number_raw,
        vendor_name_raw,
        invoice_number,
        invoice_date,
        due_date,
        amount,
        prev_payments,
        description,
        processing_notes,
        property_address,
        account_status,
        website_name,
        vendor_account_id,
        vendor_id,
        property_id,
        vendor_account_picked,
        submitted_by,
        status
    )
    VALUES (
        v_bill.account_number_raw,
        v_bill.vendor_name_raw,
        v_bill.invoice_number,
        v_bill.invoice_date,
        v_bill.due_date,
        v_bill.amount,
        v_bill.prev_payments,
        v_bill.description,
        v_bill.processing_notes,
        v_bill.property_address,
        v_bill.account_status,
        v_bill.website_name,
        v_bill.vendor_account_id,
        v_bill.vendor_id,
        v_bill.property_id,
        coalesce(v_bill.vendor_account_picked, false),
        p_user_id,
        'pending_approval'
    )
    RETURNING bill_id INTO v_bill_id;

    -- Create its initial approval record.
    INSERT INTO public.approvals (
        bill_id,
        approval_status
    )
    VALUES (
        v_bill_id,
        'pending'
    );

    RETURN v_bill_id;
END;
$$;
-- Only the trusted backend service role should execute this function.
REVOKE ALL ON FUNCTION public.create_bill_with_approval(jsonb, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_bill_with_approval(jsonb, uuid)
TO service_role;

CREATE OR REPLACE FUNCTION public.resubmit_bill_with_approval(
    p_bill_id uuid,
    p_fields jsonb,
    p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_bill public.bills%ROWTYPE;
    v_fields public.bills%ROWTYPE;
BEGIN
    -- Lock the bill so simultaneous resubmissions cannot proceed.
    SELECT *
    INTO v_bill
    FROM public.bills
    WHERE bill_id = p_bill_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bill not found.'
            USING ERRCODE = 'P0002';
    END IF;

    -- Only the original submitter may resubmit this bill.
    IF v_bill.submitted_by <> p_user_id THEN
        RAISE EXCEPTION 'You are not authorized to resubmit this bill.'
            USING ERRCODE = '42501';
    END IF;

    -- Only rejected bills can be resubmitted.
    IF v_bill.status <> 'rejected' THEN
        RAISE EXCEPTION 'Only rejected bills can be resubmitted.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Convert the validated API payload into typed fields.
    v_fields := jsonb_populate_record(
        NULL::public.bills,
        p_fields
    );

    -- Update the existing bill with the revised invoice information.
    UPDATE public.bills
    SET
        account_number_raw = v_fields.account_number_raw,
        vendor_name_raw = v_fields.vendor_name_raw,
        invoice_number = v_fields.invoice_number,
        invoice_date = v_fields.invoice_date,
        due_date = v_fields.due_date,
        amount = v_fields.amount,
        prev_payments = v_fields.prev_payments,
        description = v_fields.description,
        processing_notes = v_fields.processing_notes,
        property_address = v_fields.property_address,
        account_status = v_fields.account_status,
        website_name = v_fields.website_name,
        vendor_account_id = v_fields.vendor_account_id,
        vendor_id = v_fields.vendor_id,
        property_id = v_fields.property_id,
        vendor_account_picked = coalesce(v_fields.vendor_account_picked, false),
        status = 'pending_approval'
    WHERE bill_id = p_bill_id;

    -- Create a NEW pending approval record.
    -- The previous rejected approval remains unchanged.
    INSERT INTO public.approvals (
        bill_id,
        approval_status
    )
    VALUES (
        p_bill_id,
        'pending'
    );

    RETURN p_bill_id;
END;
$function$;
-- Only the trusted backend service role can execute this function.
REVOKE ALL ON FUNCTION public.resubmit_bill_with_approval(
    uuid, jsonb, uuid
)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_bill_with_approval(
    uuid, jsonb, uuid
)
TO service_role;


CREATE OR REPLACE FUNCTION public.submit_draft_bill_with_approval(
    p_bill_id uuid,
    p_fields jsonb,
    p_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_bill public.bills%ROWTYPE;
    v_submitted_bill_id uuid;
BEGIN
    -- Lock the existing bill.
    SELECT *
    INTO v_bill
    FROM public.bills
    WHERE bill_id = p_bill_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Editable draft not found.'
            USING ERRCODE = 'P0002';
    END IF;

    -- Verify ownership.
    IF v_bill.submitted_by <> p_user_id THEN
        RAISE EXCEPTION 'Editable draft not found.'
            USING ERRCODE = '42501';
    END IF;

    -- Only drafts can be submitted.
    IF v_bill.status <> 'draft' THEN
        RAISE EXCEPTION 'This bill has already been submitted.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Update the existing draft.
    UPDATE public.bills
    SET
        account_number_raw = p_fields->>'account_number_raw',
        vendor_name_raw = p_fields->>'vendor_name_raw',
        invoice_number = p_fields->>'invoice_number',
        invoice_date = (p_fields->>'invoice_date')::date,
        due_date = (p_fields->>'due_date')::date,
        amount = (p_fields->>'amount')::numeric,
        prev_payments = (p_fields->>'prev_payments')::numeric,
        description = p_fields->>'description',
        processing_notes = p_fields->>'processing_notes',
        property_address = p_fields->>'property_address',
        account_status = p_fields->>'account_status',
        website_name = p_fields->>'website_name',
        vendor_account_id = (p_fields->>'vendor_account_id')::uuid,
        vendor_id = (p_fields->>'vendor_id')::uuid,
        property_id = (p_fields->>'property_id')::uuid,
        vendor_account_picked = coalesce((p_fields->>'vendor_account_picked')::boolean, false),
        status = 'pending_approval'
    WHERE bill_id = p_bill_id
    RETURNING bill_id INTO v_submitted_bill_id;

    -- Create the pending approval.
    INSERT INTO public.approvals (
        bill_id,
        approval_status
    )
    VALUES (
        v_submitted_bill_id,
        'pending'
    );

    RETURN v_submitted_bill_id;
END;
$function$;

-- Only the backend service role may execute this function.
REVOKE ALL ON FUNCTION public.submit_draft_bill_with_approval(
    uuid, jsonb, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.submit_draft_bill_with_approval(
    uuid, jsonb, uuid
) TO service_role;
