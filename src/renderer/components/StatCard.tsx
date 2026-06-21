/**
 * @file StatCard.tsx
 * @description Small reusable stat card for the analytics tabs (#57; reused by
 * #58 Models). Presentational only — no data fetching. Keep the props stable
 * for downstream reuse.
 */

type StatCardProps = {
  label: string;
  value: string;
  /** Optional secondary line (e.g. "3 of 5 priced" for the cost card). */
  hint?: string;
};

export const StatCard = ({ label, value, hint }: StatCardProps) => {
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-gray-400">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-gray-100 tabular-nums">
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-gray-500">{hint}</div>}
    </div>
  );
};
