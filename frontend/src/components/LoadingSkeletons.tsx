import type { ReactNode } from 'react';

import { cn } from '../lib/utils';
import { Skeleton } from './ui/skeleton';

// Fixed widths so the placeholder looks like real content without layout shift.
const MESSAGE_WIDTHS = ['w-3/5', 'w-2/5', 'w-4/5', 'w-1/2', 'w-2/3', 'w-1/3'];
const ROW_WIDTHS = ['w-3/4', 'w-1/2', 'w-2/3', 'w-3/5', 'w-5/6', 'w-2/5'];

function SkeletonStatus({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className} role="status">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function MessageSkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-start gap-3">
          <Skeleton className="h-8 w-8 flex-shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className={cn('h-9', MESSAGE_WIDTHS[i % MESSAGE_WIDTHS.length])} />
          </div>
        </div>
      ))}
    </>
  );
}

export function MessageListSkeleton({ label, className }: { label: string; className?: string }) {
  return (
    <SkeletonStatus label={label} className={cn('flex flex-col gap-5', className)}>
      <MessageSkeletonRows count={6} />
    </SkeletonStatus>
  );
}

export function ListSkeleton({
  label,
  rows = 8,
  className,
}: {
  label: string;
  rows?: number;
  className?: string;
}) {
  return (
    <SkeletonStatus label={label} className={cn('flex flex-col gap-1', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-2.5 px-3 py-2">
          <Skeleton className="h-6 w-6 flex-shrink-0 rounded-full" />
          <Skeleton className={cn('h-3.5', ROW_WIDTHS[i % ROW_WIDTHS.length])} />
        </div>
      ))}
    </SkeletonStatus>
  );
}

export function FormSkeleton({
  label,
  fields = 5,
  className,
}: {
  label: string;
  fields?: number;
  className?: string;
}) {
  return (
    <SkeletonStatus label={label} className={cn('flex flex-col gap-5', className)}>
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
    </SkeletonStatus>
  );
}

export function DetailPaneSkeleton({ label, className }: { label: string; className?: string }) {
  return (
    <SkeletonStatus label={label} className={cn('flex flex-col', className)}>
      <div className="flex items-start gap-4 border-b border-border px-5 pb-4 pt-5">
        <Skeleton className="h-12 w-12 flex-shrink-0 rounded-full" />
        <div className="flex flex-1 flex-col gap-2 pt-1">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <div className="flex flex-col gap-3 px-5 py-4">
        {ROW_WIDTHS.map((width, i) => (
          <Skeleton key={i} className={cn('h-3.5', width)} />
        ))}
      </div>
      <div className="px-5 py-2">
        <Skeleton className="h-32 w-full" />
      </div>
    </SkeletonStatus>
  );
}

export function TextSkeleton({ label, lines = 2 }: { label: string; lines?: number }) {
  return (
    <SkeletonStatus label={label} className="flex flex-col gap-1.5 py-0.5">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </SkeletonStatus>
  );
}

export function PaneSkeleton({ label, className }: { label: string; className?: string }) {
  return (
    <SkeletonStatus label={label} className={cn('flex flex-1 flex-col gap-3 p-4', className)}>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="w-full flex-1" />
    </SkeletonStatus>
  );
}
