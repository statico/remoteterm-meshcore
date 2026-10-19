import * as React from 'react';

import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-md bg-muted motion-safe:animate-pulse', className)}
      aria-hidden="true"
      {...props}
    />
  );
}

export { Skeleton };
