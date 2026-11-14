
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
