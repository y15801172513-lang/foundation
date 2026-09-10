import {cn} from '@/lib/utils';

export function PageTitle({as: Component = 'h1', className, ...props}) {
  return <Component className={cn('text-2xl font-semibold leading-snug', className)} {...props} />;
}

export function PanelTitle({as: Component = 'h2', className, ...props}) {
  return <Component className={cn('font-heading text-xl font-medium leading-snug', className)} {...props} />;
}

export function SectionTitle({as: Component = 'h3', className, ...props}) {
  return <Component className={cn('text-lg font-medium leading-snug', className)} {...props} />;
}

export function ImportantText({as: Component = 'p', className, ...props}) {
  return <Component className={cn('text-base leading-relaxed', className)} {...props} />;
}

export function ContentDescription({as: Component = 'p', className, ...props}) {
  return <Component className={cn('text-xs leading-relaxed text-muted-foreground', className)} {...props} />;
}

export function MetadataText({as: Component = 'span', className, ...props}) {
  return <Component className={cn('text-xs leading-normal text-muted-foreground', className)} {...props} />;
}

export function CodeText({as: Component = 'code', className, ...props}) {
  return <Component className={cn('font-mono text-xs leading-normal', className)} {...props} />;
}
