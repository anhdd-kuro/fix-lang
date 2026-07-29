/**
 * @file Skeleton.tsx
 * @description Animated placeholder for loading states. Matches the app's card
 * styling and uses a pulse animation to indicate content is loading.
 */
import { twJoin } from "tailwind-merge";

type SkeletonProps = {
  className?: string;
};

export const Skeleton = ({ className }: SkeletonProps) => (
  <div
    className={twJoin(
      "animate-pulse rounded bg-muted/60",
      className,
    )}
    aria-hidden="true"
  />
);

type SkeletonCardProps = {
  rows?: number;
  className?: string;
};

export const SkeletonCard = ({ rows = 2, className }: SkeletonCardProps) => (
  <div
    className={twJoin(
      "rounded-lg border border-card-control-border bg-card p-3",
      className,
    )}
  >
    <Skeleton className="mb-2 h-3 w-24" />
    {Array.from({ length: rows }).map((_, i) => (
      <Skeleton key={i} className={twJoin("h-5 w-full", i > 0 && "mt-1.5")} />
    ))}
  </div>
);

export const UsagePanelSkeleton = () => (
  <div className="flex h-full flex-col gap-3 overflow-y-auto p-1" aria-busy="true" aria-label="Loading usage data">
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        <Skeleton className="h-6 w-10 rounded-sm" />
        <Skeleton className="h-6 w-10 rounded-sm" />
      </div>
      <Skeleton className="ml-auto h-6 w-16 rounded-sm" />
    </div>
    <SkeletonCard rows={1} />
    <SkeletonCard rows={2} />
    <SkeletonCard rows={3} />
  </div>
);
