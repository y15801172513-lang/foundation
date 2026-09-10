import {Button} from '@/components/ui/button';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';

export function FoundationIconButton({label, children, variant = 'ghost', ...props}) {
  return <Tooltip><TooltipTrigger render={<Button size="icon-sm" variant={variant} aria-label={label} title={label} {...props}>{children}</Button>} /><TooltipContent>{label}</TooltipContent></Tooltip>;
}
