import * as React from 'npm:react@18.3.1'
import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  firstName?: string
  plan?: string
  trialEndsAt?: string
  ctaUrl?: string
}

const Email = ({ firstName = 'there', plan = 'Free', trialEndsAt, ctaUrl = 'https://bishopaisign.lovable.app/dashboard' }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{`Welcome to BishopAI Sign, ${firstName}. Your first signature is 2 minutes away.`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Heading style={brand}>BishopAI Sign</Heading>
        </Section>
        <Section style={card}>
          <Heading style={h1}>{`Welcome, ${firstName}.`}</Heading>
          <Text style={text}>
            Thanks for joining BishopAI Sign. You are on the <strong>{plan}</strong> plan.
            {trialEndsAt ? ` Your 14-day free trial ends on ${new Date(trialEndsAt).toLocaleDateString()}.` : ''}
          </Text>
          <Text style={text}>Here is the fastest way to send your first envelope:</Text>
          <ol style={list}>
            <li style={li}>Upload a PDF from your dashboard.</li>
            <li style={li}>Add a signer and drop a signature field.</li>
            <li style={li}>Hit Send. That is it.</li>
          </ol>
          <Button href={ctaUrl} style={button}>Send your first document</Button>
          <Text style={muted}>Reply to this email any time. I read every message.</Text>
          <Text style={muted}>- Richmond</Text>
        </Section>
        <Text style={footer}>BishopAI Sign · Secure e-signatures</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: Email,
  subject: (d: Props) => `Welcome to BishopAI Sign, ${d?.firstName || 'there'}. Your first signature is 2 minutes away`,
  displayName: 'Welcome email',
  previewData: { firstName: 'Jane', plan: 'Pro', trialEndsAt: new Date(Date.now() + 14 * 864e5).toISOString(), ctaUrl: 'https://bishopaisign.lovable.app/dashboard' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { maxWidth: '560px', margin: '0 auto', padding: '32px 20px' }
const header = { padding: '0 0 16px' }
const brand = { fontSize: '18px', color: '#1B2A4A', margin: 0, letterSpacing: '-0.01em' }
const card = { backgroundColor: '#F7F8FB', border: '1px solid #E5E8F0', borderRadius: '12px', padding: '28px' }
const h1 = { fontSize: '22px', color: '#1B2A4A', margin: '0 0 12px' }
const text = { fontSize: '15px', color: '#1B2A4A', lineHeight: '22px', margin: '0 0 12px' }
const list = { paddingLeft: '20px', margin: '0 0 16px', color: '#1B2A4A' }
const li = { fontSize: '15px', lineHeight: '22px', margin: '0 0 6px' }
const button = { backgroundColor: '#C9A227', color: '#1B2A4A', padding: '12px 22px', borderRadius: '8px', fontWeight: 600, textDecoration: 'none', display: 'inline-block', margin: '16px 0' }
const muted = { fontSize: '13px', color: '#6B7280', margin: '8px 0 0' }
const footer = { fontSize: '11px', color: '#9CA3AF', textAlign: 'center' as const, marginTop: '24px' }
