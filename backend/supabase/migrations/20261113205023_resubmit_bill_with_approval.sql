
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
