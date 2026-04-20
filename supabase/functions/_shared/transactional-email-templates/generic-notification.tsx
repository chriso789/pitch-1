import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'PITCH CRM'

interface GenericNotificationProps {
  heading?: string
  message?: string
  name?: string
}

const GenericNotificationEmail = ({
  heading,
  message,
  name,
}: GenericNotificationProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>{heading || `Notification from ${SITE_NAME}`}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>{heading || 'Notification'}</Heading>
        <Text style={text}>
          {name ? `Hi ${name},` : 'Hello,'}
        </Text>
        <Text style={text}>
          {message || `You have a new notification from ${SITE_NAME}.`}
        </Text>
        <Text style={footer}>— The {SITE_NAME} Team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: GenericNotificationEmail,
  subject: (data: Record<string, any>) =>
    data.heading || `Notification from ${SITE_NAME}`,
  displayName: 'Generic notification',
  previewData: {
    heading: 'Welcome to PITCH CRM',
    message: 'Thanks for joining. This is a sample notification email.',
    name: 'Jane',
  },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily: 'Inter, Arial, sans-serif',
}
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold',
  color: '#0f172a',
  margin: '0 0 20px',
}
const text = {
  fontSize: '14px',
  color: '#475569',
  lineHeight: '1.6',
  margin: '0 0 16px',
}
const footer = {
  fontSize: '12px',
  color: '#94a3b8',
  margin: '32px 0 0',
}
