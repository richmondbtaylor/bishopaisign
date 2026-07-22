import * as React from 'npm:react@18.3.1'
import { Body, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  documentTitle?: string
  declinerName?: string
  declinerEmail?: string
  reason?: string
  recipientName?: string
}

const Email = ({ documentTitle = 'your document', declinerName, declinerEmail, reason, recipientName }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`${declinerName || declinerEmail || 'A signer'} declined to sign ${documentTitle}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={brand}>BishopAI Sign</Heading>
        <Section style={card}>
          <Heading style={h1}>Signature declined</Heading>
          <Text style={text}>{recipientName ? `Hi ${recipientName},` : 'Hi,'}</Text>
          <Text style={text}>
            <strong>{declinerName || declinerEmail || 'A signer'}</strong> declined to sign <strong>{documentTitle}</strong>.
          </Text>
          {reason ? (
            <>
              <Text style={label}>Reason provided:</Text>
              <Text style={quote}>&ldquo;{reason}&rdquo;</Text>
            </>
          ) : null}
        </Section>
        <Text style={footer}>BishopAI Sign · Secure e-signatures</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Props) => `Declined: ${d?.documentTitle || 'Your document'}`,
  displayName: 'Signing Declined',
  previewData: { documentTitle: 'MSA v3.pdf', declinerName: 'Jane Doe', declinerEmail: 'jane@example.com', reason: 'Terms need revision.', recipientName: 'Richmond' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { maxWidth: '560px', margin: '0 auto', padding: '32px 20px' }
const brand = { fontSize: '18px', color: '#1B2A4A', margin: '0 0 16px' }
const card = { backgroundColor: '#F7F8FB', border: '1px solid #E5E8F0', borderRadius: '12px', padding: '28px' }
const h1 = { fontSize: '22px', color: '#1B2A4A', margin: '0 0 12px' }
const text = { fontSize: '15px', color: '#1B2A4A', lineHeight: '22px', margin: '0 0 12px' }
const label = { fontSize: '13px', color: '#6B7280', margin: '12px 0 4px', textTransform: 'uppercase' as const, letterSpacing: '0.04em' }
const quote = { fontSize: '14px', color: '#1B2A4A', borderLeft: '3px solid #C9A227', paddingLeft: '12px', margin: 0, fontStyle: 'italic' as const }
const footer = { fontSize: '11px', color: '#9CA3AF', textAlign: 'center' as const, marginTop: '24px' }
