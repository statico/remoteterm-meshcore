import { Loader2 } from 'lucide-react';

import { cn } from '../lib/utils';

export function LoadingIndicator({ label, className }: { label: string; className?: string }) {
  return (
    <div
      className={cn('flex items-center justify-center gap-2 text-muted-foreground', className)}
      role="status"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
