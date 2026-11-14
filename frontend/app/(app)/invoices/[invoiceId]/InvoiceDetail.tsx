"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "@/auth/AuthProvider";
import { StatusBadge } from "@/components/Status-Badge/status-badge";
import { decideApproval, getApprovals } from "@/lib/api/approvals";
import { getBill, getBillDocument } from "@/lib/api/bills";
import type { Approval, ApprovalDecisionType } from "@/types/approval";
import type { Bill } from "@/types/bill";

function formatDate(date: string | null) {
  if (!date) return "—";

  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export default function InvoiceDetail() {
  const params = useParams<{ invoiceId: string }>();
  const invoiceId = params.invoiceId;

  const [bill, setBill] = useState<Bill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [documentError, setDocumentError] = useState<string | null>(null);

  const { profile, loading: accountLoading } = useAuth();

  const canReview =
    !accountLoading &&
    profile?.status === "active" &&
    (profile?.role === "approver" || profile?.role === "admin");

  const [approval, setApproval] = useState<Approval | null>(null);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const [decision, setDecision] = useState<ApprovalDecisionType | null>(null);
  const [comments, setComments] = useState("");
  const [confirmingDecision, setConfirmingDecision] = useState(false);
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  useEffect(() => {
    if (!invoiceId) return;

    let cancelled = false;

    async function loadBill() {
      setLoading(true);
      setError(null);
      setBill(null);

      setDocumentUrl(null);
      setDocumentError(null);
      setDocumentLoading(false);

      try {
        const result = await getBill(invoiceId);

        if (cancelled) return;

        setBill(result);
        setError(null);

        if (result.document_path) {
          setDocumentLoading(true);

          try {
            const document = await getBillDocument(invoiceId);

            if (!cancelled) {
              setDocumentUrl(document.document_url);
              setDocumentError(null);
            }
          } catch (err) {
            if (!cancelled) {
              setDocumentError(err instanceof Error ? err.message : "Unable to load invoice PDF.");
            }
          } finally {
            if (!cancelled) {
              setDocumentLoading(false);
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load invoice.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadBill();

    return () => {
      cancelled = true;
    };
  }, [invoiceId]);

  useEffect(() => {
    if (!canReview || !invoiceId || bill?.status !== "pending_approval") {
      setApproval(null);
      setApprovalLoading(false);
      setApprovalError(null);
      return;
    }

    let cancelled = false;

    async function loadApproval() {
      setApproval(null);
      setApprovalError(null);
      setApprovalLoading(true);

      try {
        const approvals = await getApprovals({
          status: "pending",
          bill_id: invoiceId,
          limit: 1,
        });

        if (!cancelled) {
          setApproval(approvals[0] ?? null);
          setApprovalError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setApprovalError(err instanceof Error ? err.message : "Unable to load approval.");
        }
      } finally {
        if (!cancelled) {
          setApprovalLoading(false);
        }
      }
    }

    void loadApproval();

    return () => {
      cancelled = true;
    };
  }, [bill?.status, canReview, invoiceId]);

  function handleDecisionSelect(nextDecision: ApprovalDecisionType) {
    setDecision(nextDecision);
    setConfirmingDecision(false);
    setDecisionError(null);
  }

  function cancelDecision() {
    setDecision(null);
    setConfirmingDecision(false);
    setDecisionError(null);
  }

  async function submitDecision() {
    if (!approval || !decision || !bill || submittingDecision) return;

    const trimmedComments = comments.trim();

    if (decision === "reject" && !trimmedComments) {
      setDecisionError("A comment is required when rejecting an invoice.");
      return;
    }

    setSubmittingDecision(true);
    setDecisionError(null);

    try {
      const result = await decideApproval(approval.id, {
        decision,
        comments: trimmedComments || null,
      });

      setApproval(result);
      setBill((currentBill) =>
        currentBill
          ? {
              ...currentBill,
              status: decision === "approve" ? "approved" : "rejected",
            }
          : currentBill,
      );

      setDecision(null);
      setComments("");
      setConfirmingDecision(false);
    } catch (err) {
      setDecisionError(err instanceof Error ? err.message : "Unable to submit your decision.");
    } finally {
      setSubmittingDecision(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl pt-16">
        <p role="status" className="text-sm text-foreground-muted">
          Loading invoice...
        </p>
      </div>
    );
  }

  if (error || !bill) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 pt-16">
        <p role="alert" className="text-sm text-red-600">
          {error ?? "Invoice not found."}
        </p>

        <Link href="/dashboard" className="text-sm font-medium text-primary hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 pt-16">
      <Link href="/dashboard" className="text-sm text-foreground-muted hover:text-foreground">
        ← Back to dashboard
      </Link>

      <section className="rounded-xl border border-border bg-surface p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-foreground-muted">Invoice</p>
            <h1 className="text-2xl font-semibold text-foreground">{bill.invoice_number}</h1>
          </div>

          <StatusBadge status={bill.status} />
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <p className="text-sm text-foreground-muted">Vendor</p>
            <p className="font-medium">{bill.vendor_name_raw ?? "—"}</p>
          </div>

          <div>
            <p className="text-sm text-foreground-muted">Property</p>
            <p className="font-medium">{bill.property_address ?? "—"}</p>
          </div>

          <div>
            <p className="text-sm text-foreground-muted">Account number</p>
            <p className="font-medium">{bill.account_number_raw}</p>
          </div>

          <div>
            <p className="text-sm text-foreground-muted">Invoice date</p>
            <p className="font-medium">{formatDate(bill.invoice_date)}</p>
          </div>

          <div>
            <p className="text-sm text-foreground-muted">Due date</p>
            <p className="font-medium">{formatDate(bill.due_date)}</p>
          </div>

          <div>
            <p className="text-sm text-foreground-muted">Submitted by</p>
            <p className="font-medium">{bill.submitted_by.full_name}</p>
          </div>
        </div>

        <div className="mt-8 border-t border-border pt-6">
          <p className="text-sm text-foreground-muted">Invoice amount</p>
          <p className="text-3xl font-semibold tabular-nums">
            {currency.format(Number(bill.amount))}
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Description</h2>
        <p className="mt-2 text-sm text-foreground-muted">
          {bill.description || "No description provided."}
        </p>
      </section>

      {bill.status === "pending_approval" && canReview && (
        <section className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Approval Decision</h2>
              <p className="mt-1 text-sm text-foreground-muted">
                Review this invoice and record your decision.
              </p>
            </div>

            <StatusBadge status="pending_approval" />
          </div>

          {approvalLoading && (
            <p role="status" className="mt-4 text-sm text-foreground-muted">
              Loading approval details...
            </p>
          )}

          {approvalError && (
            <p role="alert" className="mt-4 text-sm text-red-600">
              {approvalError}
            </p>
          )}

          {!approvalLoading && !approvalError && !approval && (
            <p className="mt-4 text-sm text-foreground-muted">
              No pending approval record was found for this invoice.
            </p>
          )}

          {approval && (
            <>
              {Number(bill.amount) > 5000 && profile?.role !== "admin" ? (
                <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4">
                  <p className="font-medium text-amber-900">Admin review required</p>
                  <p className="mt-1 text-sm text-amber-800">
                    Invoices over $5,000 must be reviewed by an administrator. You can view this
                    invoice, but cannot submit a decision.
                  </p>
                </div>
              ) : (
                <div className="mt-5 space-y-4">
                  {!decision && (
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => handleDecisionSelect("approve")}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                      >
                        Approve invoice
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDecisionSelect("reject")}
                        className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                      >
                        Reject invoice
                      </button>
                    </div>
                  )}

                  {decision && (
                    <div className="space-y-4 rounded-lg border border-border p-4">
                      <div>
                        <h3 className="font-semibold">
                          {decision === "approve"
                            ? "Approve this invoice?"
                            : "Reject this invoice?"}
                        </h3>

                        <p className="mt-1 text-sm text-foreground-muted">
                          {decision === "approve"
                            ? "You can optionally leave a comment for the record."
                            : "Please provide a meaningful reason for rejecting this invoice."}
                        </p>
                      </div>

                      <div>
                        <label
                          htmlFor="approval-comments"
                          className="mb-2 block text-sm font-medium"
                        >
                          Comments {decision === "reject" ? "(required)" : "(optional)"}
                        </label>

                        <textarea
                          id="approval-comments"
                          value={comments}
                          onChange={(event) => {
                            setComments(event.target.value);
                            setDecisionError(null);
                          }}
                          rows={4}
                          maxLength={2000}
                          placeholder={
                            decision === "reject"
                              ? "Explain why this invoice is being rejected..."
                              : "Add an optional approval comment..."
                          }
                          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
                          disabled={submittingDecision}
                        />
                      </div>

                      {decisionError && (
                        <p role="alert" className="text-sm text-red-600">
                          {decisionError}
                        </p>
                      )}

                      {!confirmingDecision ? (
                        <div className="flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              if (decision === "reject" && !comments.trim()) {
                                setDecisionError(
                                  "A comment is required when rejecting an invoice.",
                                );
                                return;
                              }

                              setDecisionError(null);
                              setConfirmingDecision(true);
                            }}
                            disabled={decision === "reject" && !comments.trim()}
                            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Continue
                          </button>

                          <button
                            type="button"
                            onClick={cancelDecision}
                            disabled={submittingDecision}
                            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface-secondary disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <p className="text-sm font-medium text-foreground">
                            {decision === "approve"
                              ? "Confirm that you want to approve this invoice."
                              : "Confirm that you want to reject this invoice."}
                          </p>

                          <div className="flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() => void submitDecision()}
                              disabled={submittingDecision}
                              className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50 ${
                                decision === "approve" ? "bg-primary" : "bg-red-600"
                              }`}
                            >
                              {submittingDecision
                                ? "Submitting..."
                                : decision === "approve"
                                  ? "Confirm approval"
                                  : "Confirm rejection"}
                            </button>

                            <button
                              type="button"
                              onClick={() => setConfirmingDecision(false)}
                              disabled={submittingDecision}
                              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-surface-secondary disabled:opacity-50"
                            >
                              Go back
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}

      <section className="rounded-xl border border-border bg-surface p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Invoice Document</h2>

        {documentLoading && (
          <p role="status" className="mt-4 text-sm text-foreground-muted">
            Loading PDF...
          </p>
        )}

        {documentError && (
          <p role="alert" className="mt-4 text-sm text-red-600">
            {documentError}
          </p>
        )}

        {!bill.document_path && (
          <p className="mt-4 text-sm text-foreground-muted">No PDF attached to this invoice.</p>
        )}

        {documentUrl && (
          <iframe
            src={documentUrl}
            title={`Invoice ${bill.invoice_number}`}
            className="mt-4 h-175 w-full rounded-lg border border-border"
          />
        )}
      </section>
    </main>
  );
}
