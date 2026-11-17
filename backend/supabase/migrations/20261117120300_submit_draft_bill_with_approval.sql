
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
