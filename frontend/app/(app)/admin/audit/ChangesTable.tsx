"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import { badgeTones } from "@/components/Status-Badge/status-badge";
import type { AuditAction, AuditChange } from "@/types/audit";
import {
  ACTION_LABELS,
  actorName,
  fieldDiffs,
  formatValue,
  formatWhen,
  shortId,
  tableLabel,
} from "./format";

const COPY = {
  label: "Changes",
  details: "Details",
  show: (id: number) => `Show details for change ${id}`,
  hide: (id: number) => `Hide details for change ${id}`,
  when: "When",
  who: "Who",
  table: "Table",
  action: "Action",
  record: "Record",
  fields: "Changed fields",
  field: "Field",
  before: "Before",
  after: "After",
  none: "-",
};

const ACTION_TONES: Record<AuditAction, keyof typeof badgeTones> = {
  created: "success",
  changed: "info",
  deleted: "danger",
};

const th = "whitespace-nowrap px-4 py-3 text-left font-medium";
const td = "px-4 py-3 align-top";

function ChangeDetails({ change }: { change: AuditChange }) {
  const diffs = fieldDiffs(change);
  const showBefore = change.action !== "created";
  const showAfter = change.action !== "deleted";

  if (diffs.length === 0) return <p className="text-foreground-muted">{COPY.none}</p>;

  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="text-foreground-muted">
          <th scope="col" className="py-1 pr-4 font-medium">
            {COPY.field}
          </th>
          {showBefore && (
            <th scope="col" className="py-1 pr-4 font-medium">
              {COPY.before}
            </th>
          )}
          {showAfter && (
            <th scope="col" className="py-1 font-medium">
              {COPY.after}
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {diffs.map((diff) => (
          <tr key={diff.field} className="border-t border-border align-top">
            <th scope="row" className="py-1.5 pr-4 font-mono font-medium">
              {diff.field}
            </th>
            {showBefore && (
              <td className="break-all py-1.5 pr-4 font-mono">{formatValue(diff.before)}</td>
            )}
            {showAfter && <td className="break-all py-1.5 font-mono">{formatValue(diff.after)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ChangesTable({ changes }: { changes: AuditChange[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());

  function toggle(id: number) {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-176 text-sm">
        <caption className="sr-only">{COPY.label}</caption>
        <thead>
          <tr className="border-b border-border text-foreground-muted">
            <th scope="col" className="w-10 px-2 py-3">
              <span className="sr-only">{COPY.details}</span>
            </th>
            <th scope="col" className={th}>
              {COPY.when}
            </th>
            <th scope="col" className={th}>
              {COPY.who}
            </th>
            <th scope="col" className={th}>
              {COPY.table}
            </th>
            <th scope="col" className={th}>
              {COPY.action}
            </th>
            <th scope="col" className={th}>
              {COPY.record}
            </th>
            <th scope="col" className={th}>
              {COPY.fields}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {changes.map((change) => {
            const expanded = open.has(change.id);
            const Chevron = expanded ? ChevronDown : ChevronRight;

            return (
              <Fragment key={change.id}>
                <tr className="text-foreground transition-colors hover:bg-surface-muted">
                  <td className="px-2 py-3 align-top">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={expanded ? COPY.hide(change.id) : COPY.show(change.id)}
                      onClick={() => toggle(change.id)}
                      className="rounded p-1 text-foreground-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Chevron aria-hidden={true} className="h-4 w-4" />
                    </button>
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{formatWhen(change.occurred_at)}</td>
                  <td className={td}>{actorName(change.actor)}</td>
                  <td className={`${td} whitespace-nowrap`}>{tableLabel(change.table)}</td>
                  <td className={td}>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeTones[ACTION_TONES[change.action]]}`}
                    >
                      {ACTION_LABELS[change.action]}
                    </span>
                  </td>
                  <td className={`${td} font-mono text-xs`} title={change.record_id ?? undefined}>
                    {change.record_id ? shortId(change.record_id) : COPY.none}
                  </td>
                  <td className={`${td} break-words`}>
                    {change.changed_fields.length > 0
                      ? change.changed_fields.join(", ")
                      : COPY.none}
                  </td>
                </tr>
                {expanded && (
                  <tr className="bg-surface-muted">
                    <td />
                    <td colSpan={6} className="px-4 py-3">
                      <ChangeDetails change={change} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
