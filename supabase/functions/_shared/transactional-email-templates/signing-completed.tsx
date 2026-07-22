import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  documentTitle?: string
  downloadUrl?: string
  recipientName?: string
}

const Email = ({ documentTitle = 'your document', downloadUrl, recipientName }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`${documentTitle} has been fully signed`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={brand}>BishopAI Sign</Heading>
        <Section style={card}>
          <Heading style={h1}>Signing complete</Heading>
          <Text style={text}>{recipientName ? `Hi ${recipientName},` : 'Hi,'}</Text>
          <Text style={text}>
            <strong>{documentTitle}</strong> has been signed by all parties. A tamper-evident Certificate of Completion is included.
          </Text>
          {downloadUrl ? <Button href={downloadUrl} style={button}>Download signed PDF</Button> : null}
        </Section>
        <Text style={footer}>BishopAI Sign · Secure e-signatures</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Props) => `Completed: ${d?.documentTitle || 'Your document'}`,
  displayName: 'Signing Completed',
  previewData: { documentTitle: 'MSA v3.pdf', downloadUrl: 'https://bishopaisign.lovable.app/documents/abc', recipientName: 'Jane' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { maxWidth: '560px', margin: '0 auto', padding: '32px 20px' }
const brand = { fontSize: '18px', color: '#1B2A4A', margin: '0 0 16px' }
const card = { backgroundColor: '#F7F8FB', border: '1px solid #E5E8F0', borderRadius: '12px', padding: '28px' }
const h1 = { fontSize: '22px', color: '#1B2A4A', margin: '0 0 12px' }
const text = { fontSize: '15px', color: '#1B2A4A', lineHeight: '22px', margin: '0 0 12px' }
const button = { backgroundColor: '#C9A227', color: '#1B2A4A', padding: '12px 22px', borderRadius: '8px', fontWeight: 600, textDecoration: 'none', display: 'inline-block', marginTop: '12px' }
const footer = { fontSize: '11px', color: '#9CA3AF', textAlign: 'center' as const, marginTop: '24px' }
