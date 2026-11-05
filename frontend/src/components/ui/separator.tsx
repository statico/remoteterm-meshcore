import { cn } from '@/lib/utils';

/** Decorative horizontal rule; same markup Radix Separator rendered with its defaults. */
export function Separator({ className }: { className?: string }) {
  return (
    <div
      role="none"
      data-orientation="horizontal"
      className={cn('shrink-0 bg-border h-[1px] w-full', className)}
    />
  );
}
