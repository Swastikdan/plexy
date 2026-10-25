'use client';

import { StatusAnnouncer as StatusAnnouncerPrimitive } from '@videojs/react';

import { cn, resolveClassName } from '@/lib/resolve-class-name';

export type StatusAnnouncerProps = Omit<StatusAnnouncerPrimitive.Props, 'children'>;

export function StatusAnnouncer({ className, ...props }: StatusAnnouncerProps = {}) {
  return (
    <StatusAnnouncerPrimitive className={(state) => cn('sr-only', resolveClassName(className, state))} {...props} />
  );
}
