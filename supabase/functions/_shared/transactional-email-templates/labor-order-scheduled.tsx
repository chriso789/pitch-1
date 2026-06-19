import * as React from 'npm:react@18.3.1'
import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'PITCH CRM'

interface Props {
  recipientName?: string
  recipientRole?: string
  jobNumber?: string
  projectName?: string
  address?: string
  scheduledDate?: string
  crewName?: string
  orderTitle?: string
  notes?: string
}

const LaborOrderScheduledEmail = ({
  recipientName,
  recipientRole,
  jobNumber,
  projectName,
  address,
  scheduledDate,
  crewName,
  orderTitle,
  notes,
}: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>
      Labor order scheduled{jobNumber ? ` for Job #${jobNumber}` : ''}
      {scheduledDate ? ` on ${scheduledDate}` : ''}
    </Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Labor Order Scheduled</Heading>
        <Text style={text}>
          {recipientName ? `Hi ${recipientName},` : 'Hello,'}
        </Text>
        <Text style={text}>
          {recipientRole === 'crew'
            ? 'A labor order has been scheduled and assigned to your crew.'
            : 'A labor order on one of your projects has been scheduled.'}
        </Text>

        <Section style={card}>
          {jobNumber ? <Text style={row}><strong>Job #:</strong> {jobNumber}</Text> : null}
          {projectName ? <Text style={row}><strong>Project:</strong> {projectName}</Text> : null}
          {orderTitle ? <Text style={row}><strong>Order:</strong> {orderTitle}</Text> : null}
          {address ? <Text style={row}><strong>Address:</strong> {address}</Text> : null}
          {scheduledDate ? <Text style={row}><strong>Scheduled:</strong> {scheduledDate}</Text> : null}
          {crewName ? <Text style={row}><strong>Crew:</strong> {crewName}</Text> : null}
          {notes ? <Text style={row}><strong>Notes:</strong> {notes}</Text> : null}
        </Section>

        <Text style={footer}>— The {SITE_NAME} Team</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: LaborOrderScheduledEmail,
  subject: (data: Record<string, any>) =>
    `Labor order scheduled${data.jobNumber ? ` — Job #${data.jobNumber}` : ''}${data.scheduledDate ? ` (${data.scheduledDate})` : ''}`,
  displayName: 'Labor order scheduled',
  previewData: {
    recipientName: 'Chris',
    recipientRole: 'crew',
    jobNumber: 'CLJ-1042',
    projectName: 'Worthouse Tile Replacement',
    address: '123 Main St, Tampa, FL',
    scheduledDate: 'Mon, Jun 24, 2026',
    crewName: 'Alpha Roofing Crew',
    orderTitle: 'Labor Order – Worthouse Supreme',
    notes: 'Drop materials at front driveway.',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: 'Inter, Arial, sans-serif' }
const container = { padding: '24px 28px', maxWidth: '560px' }
const h1 = { fontSize: '22px', fontWeight: 'bold', color: '#0f172a', margin: '0 0 16px' }
const text = { fontSize: '14px', color: '#475569', lineHeight: '1.6', margin: '0 0 12px' }
const card = { backgroundColor: '#f8fafc', borderRadius: '8px', padding: '16px 18px', margin: '16px 0' }
const row = { fontSize: '14px', color: '#0f172a', margin: '0 0 8px', lineHeight: '1.5' }
const footer = { fontSize: '12px', color: '#94a3b8', margin: '24px 0 0' }
