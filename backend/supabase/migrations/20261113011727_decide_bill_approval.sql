
CREATE OR REPLACE FUNCTION public.decide_bill_approval(
    p_approval_id uuid,
    p_reviewer_id uuid,
    p_decision text,
    p_comments text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    v_approval public.approvals%ROWTYPE;
    v_bill public.bills%ROWTYPE;
    v_reviewer_role text;
    v_reviewer_status text;
    v_decision_at timestamptz := now();
    v_comments text := NULLIF(btrim(p_comments), '');
BEGIN
    -- Validate the requested decision.
    IF p_decision NOT IN ('approve', 'reject') THEN
        RAISE EXCEPTION 'Invalid approval decision.'
            USING ERRCODE = '22023';
    END IF;

    -- A rejection must include a meaningful reason.
    IF p_decision = 'reject' AND v_comments IS NULL THEN
        RAISE EXCEPTION 'A comment is required when rejecting an approval.'
            USING ERRCODE = '22023';
    END IF;

    -- Lock the approval record to prevent simultaneous decisions.
    SELECT *
    INTO v_approval
    FROM public.approvals
    WHERE approval_id = p_approval_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Approval record not found.'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_approval.approval_status <> 'pending' THEN
        RAISE EXCEPTION 'This approval has already been decided.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Lock the associated bill.
    SELECT *
    INTO v_bill
    FROM public.bills
    WHERE bill_id = v_approval.bill_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Associated bill not found.'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_bill.status <> 'pending_approval' THEN
        RAISE EXCEPTION 'This bill is not awaiting approval.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Verify the reviewer using the database user record.
    SELECT role, status
    INTO v_reviewer_role, v_reviewer_status
    FROM public.app_users
    WHERE user_id = p_reviewer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Reviewer account not found.'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_reviewer_status <> 'active' THEN
        RAISE EXCEPTION 'Reviewer account is not active.'
            USING ERRCODE = '42501';
    END IF;

    IF v_reviewer_role NOT IN ('approver', 'admin') THEN
        RAISE EXCEPTION 'User is not authorized to review approvals.'
            USING ERRCODE = '42501';
    END IF;

    -- Bills above $5,000 require an admin.
    IF v_bill.amount > 5000
       AND v_reviewer_role <> 'admin' THEN
        RAISE EXCEPTION 'An admin must review bills over $5,000.'
            USING ERRCODE = '42501';
    END IF;

    -- Record the approval decision.
    UPDATE public.approvals
    SET
        approval_status = CASE
            WHEN p_decision = 'approve' THEN 'approved'
            ELSE 'rejected'
        END,
        reviewer_id = p_reviewer_id,
        decision_at = v_decision_at,
        comments = v_comments
    WHERE approval_id = p_approval_id;

    -- Update the associated bill.
    UPDATE public.bills
    SET status = CASE
        WHEN p_decision = 'approve' THEN 'approved'
        ELSE 'rejected'
    END
    WHERE bill_id = v_approval.bill_id;

    RETURN jsonb_build_object(
        'approval_id', p_approval_id,
        'bill_id', v_approval.bill_id,
        'approval_status',
            CASE WHEN p_decision = 'approve'
                 THEN 'approved' ELSE 'rejected' END,
        'bill_status',
            CASE WHEN p_decision = 'approve'
                 THEN 'approved' ELSE 'rejected' END,
        'reviewer_id', p_reviewer_id,
        'decision_at', v_decision_at,
        'comments', v_comments
    );
END;
$function$;

-- Only the backend service role may execute this function.
REVOKE ALL ON FUNCTION public.decide_bill_approval(
    uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.decide_bill_approval(
    uuid, uuid, text, text
) TO service_role;
