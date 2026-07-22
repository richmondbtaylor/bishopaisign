import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  senderName?: string
  documentTitle?: string
  signingUrl?: string
  recipientName?: string
  message?: string
}

const Email = ({ senderName = 'Someone', documentTitle = 'a document', signingUrl = '#', recipientName, message }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`${senderName} has requested your signature on ${documentTitle}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Heading style={brand}>BishopAI Sign</Heading>
        </Section>
        <Section style={card}>
          <Heading style={h1}>Signature requested</Heading>
          <Text style={text}>{recipientName ? `Hi ${recipientName},` : 'Hi,'}</Text>
          <Text style={text}>
            <strong>{senderName}</strong> has requested your signature on <strong>{documentTitle}</strong>.
          </Text>
          {message ? <Text style={quote}>&ldquo;{message}&rdquo;</Text> : null}
          <Button href={signingUrl} style={button}>Review & Sign</Button>
          <Text style={muted}>Or copy this link into your browser:</Text>
          <Text style={link}>{signingUrl}</Text>
        </Section>
        <Text style={footer}>BishopAI Sign · Secure e-signatures</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Props) => `${d?.senderName || 'Someone'} requested your signature on ${d?.documentTitle || 'a document'}`,
  displayName: 'Signing Invitation',
  previewData: { senderName: 'Richmond Bishop', documentTitle: 'MSA v3.pdf', signingUrl: 'https://bishopaisign.lovable.app/sign/abc', recipientName: 'Jane' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { maxWidth: '560px', margin: '0 auto', padding: '32px 20px' }
const header = { padding: '0 0 16px' }
const brand = { fontSize: '18px', color: '#1B2A4A', margin: 0, letterSpacing: '-0.01em' }
const card = { backgroundColor: '#F7F8FB', border: '1px solid #E5E8F0', borderRadius: '12px', padding: '28px' }
const h1 = { fontSize: '22px', color: '#1B2A4A', margin: '0 0 12px' }
const text = { fontSize: '15px', color: '#1B2A4A', lineHeight: '22px', margin: '0 0 12px' }
const quote = { fontSize: '14px', color: '#4B5563', borderLeft: '3px solid #C9A227', paddingLeft: '12px', margin: '12px 0 20px', fontStyle: 'italic' as const }
const button = { backgroundColor: '#C9A227', color: '#1B2A4A', padding: '12px 22px', borderRadius: '8px', fontWeight: 600, textDecoration: 'none', display: 'inline-block', margin: '16px 0' }
const muted = { fontSize: '12px', color: '#6B7280', margin: '16px 0 4px' }
const link = { fontSize: '12px', color: '#1B2A4A', wordBreak: 'break-all' as const, margin: 0 }
const footer = { fontSize: '11px', color: '#9CA3AF', textAlign: 'center' as const, marginTop: '24px' }
