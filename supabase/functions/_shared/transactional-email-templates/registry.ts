import type { ComponentType } from 'npm:react@18.3.1'
import { template as signingInvite } from './signing-invite.tsx'
import { template as signingCompleted } from './signing-completed.tsx'
import { template as signingDeclined } from './signing-declined.tsx'
import { template as nextSigner } from './next-signer.tsx'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: any) => string)
  displayName?: string
  previewData?: Record<string, any>
  to?: string
}

export const TEMPLATES: Record<string, TemplateEntry> = {
  'signing-invite': signingInvite,
  'signing-completed': signingCompleted,
  'signing-declined': signingDeclined,
  'next-signer': nextSigner,
}
