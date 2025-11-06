// Contract Report Templates for Smart Docs System

export interface ContractStatusMetrics {
  total_contracts: number;
  draft_count: number;
  sent_count: number;
  in_progress_count: number;
  completed_count: number;
  voided_count: number;
  completion_rate: number;
  avg_completion_days: number;
}

export interface ContractTrackingData {
  envelope_id: string;
  title: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  events: Array<{
    event_type: string;
    recipient_email: string;
    occurred_at: string;
    ip_address?: string;
  }>;
}

export interface ContractVolumeMetrics {
  date: string;
  total: number;
  completed: number;
  sent: number;
}

export function generateContractStatusHTML(
  metrics: ContractStatusMetrics,
  from: string,
  to: string,
  companyName: string
): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Contract Status Report</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            margin: 40px;
            color: #1a1a1a;
            background: #fff;
          }
          .header {
            text-align: center;
            margin-bottom: 40px;
            border-bottom: 3px solid hsl(217, 91%, 60%);
            padding-bottom: 20px;
          }
          .header h1 {
            margin: 0;
            color: hsl(217, 91%, 60%);
            font-size: 28px;
            font-weight: 700;
          }
          .header p {
            margin: 8px 0;
            color: #666;
            font-size: 14px;
          }
          .metrics-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 20px;
            margin-bottom: 40px;
          }
          .metric-card {
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 24px;
            background: linear-gradient(135deg, #f9fafb 0%, #ffffff 100%);
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
          }
          .metric-label {
            font-size: 13px;
            color: #6b7280;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 600;
          }
          .metric-value {
            font-size: 36px;
            font-weight: 700;
            color: hsl(217, 91%, 60%);
            margin-bottom: 4px;
          }
          .metric-subtitle {
            font-size: 12px;
            color: #9ca3af;
            margin-top: 8px;
          }
          .status-breakdown {
            margin-top: 30px;
            padding: 24px;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            background: #fafafa;
          }
          .status-breakdown h2 {
            margin: 0 0 20px 0;
            font-size: 18px;
            color: #1a1a1a;
          }
          .status-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 0;
            border-bottom: 1px solid #e5e7eb;
          }
          .status-row:last-child {
            border-bottom: none;
          }
          .status-label {
            font-weight: 500;
            color: #374151;
          }
          .status-count {
            font-weight: 700;
            color: hsl(217, 91%, 60%);
            font-size: 18px;
          }
          .footer {
            margin-top: 50px;
            text-align: center;
            font-size: 11px;
            color: #9ca3af;
            border-top: 1px solid #e5e7eb;
            padding-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${companyName}</h1>
          <p><strong>Contract Status Report</strong></p>
          <p>${new Date(from).toLocaleDateString()} - ${new Date(to).toLocaleDateString()}</p>
        </div>

        <div class="metrics-grid">
          <div class="metric-card">
            <div class="metric-label">Total Contracts</div>
            <div class="metric-value">${metrics.total_contracts}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Completed</div>
            <div class="metric-value">${metrics.completed_count}</div>
            <div class="metric-subtitle">${metrics.completion_rate}% completion rate</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">In Progress</div>
            <div class="metric-value">${metrics.in_progress_count}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Avg. Completion</div>
            <div class="metric-value">${metrics.avg_completion_days}</div>
            <div class="metric-subtitle">days</div>
          </div>
        </div>

        <div class="status-breakdown">
          <h2>Status Breakdown</h2>
          <div class="status-row">
            <span class="status-label">📝 Draft</span>
            <span class="status-count">${metrics.draft_count}</span>
          </div>
          <div class="status-row">
            <span class="status-label">📤 Sent</span>
            <span class="status-count">${metrics.sent_count}</span>
          </div>
          <div class="status-row">
            <span class="status-label">⏳ In Progress</span>
            <span class="status-count">${metrics.in_progress_count}</span>
          </div>
          <div class="status-row">
            <span class="status-label">✅ Completed</span>
            <span class="status-count">${metrics.completed_count}</span>
          </div>
          <div class="status-row">
            <span class="status-label">🚫 Voided</span>
            <span class="status-count">${metrics.voided_count}</span>
          </div>
        </div>

        <div class="footer">
          <p>Generated on ${new Date().toLocaleString()}</p>
          <p>${companyName} - Confidential Document</p>
        </div>
      </body>
    </html>
  `;
}

export function generateContractTrackingHTML(
  contracts: ContractTrackingData[],
  from: string,
  to: string,
  companyName: string
): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Contract Tracking Report</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            margin: 40px;
            color: #1a1a1a;
            background: #fff;
          }
          .header {
            text-align: center;
            margin-bottom: 40px;
            border-bottom: 3px solid hsl(217, 91%, 60%);
            padding-bottom: 20px;
          }
          .header h1 {
            margin: 0;
            color: hsl(217, 91%, 60%);
            font-size: 28px;
            font-weight: 700;
          }
          .header p {
            margin: 8px 0;
            color: #666;
            font-size: 14px;
          }
          .contract-item {
            margin-bottom: 30px;
            padding: 20px;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            background: #fafafa;
            page-break-inside: avoid;
          }
          .contract-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 12px;
            border-bottom: 1px solid #d1d5db;
          }
          .contract-title {
            font-size: 16px;
            font-weight: 700;
            color: #1a1a1a;
          }
          .contract-status {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
          }
          .status-completed { background: #d1fae5; color: #065f46; }
          .status-sent { background: #dbeafe; color: #1e40af; }
          .status-in_progress { background: #fef3c7; color: #92400e; }
          .status-draft { background: #e5e7eb; color: #374151; }
          .status-voided { background: #fee2e2; color: #991b1b; }
          .contract-meta {
            font-size: 13px;
            color: #6b7280;
            margin-bottom: 15px;
          }
          .events-timeline {
            margin-top: 15px;
          }
          .events-title {
            font-size: 14px;
            font-weight: 600;
            color: #374151;
            margin-bottom: 10px;
          }
          .event-item {
            display: flex;
            gap: 12px;
            padding: 10px;
            margin-bottom: 8px;
            background: #fff;
            border-radius: 8px;
            font-size: 13px;
          }
          .event-icon {
            flex-shrink: 0;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: hsl(217, 91%, 60%);
            margin-top: 6px;
          }
          .event-details {
            flex: 1;
          }
          .event-type {
            font-weight: 600;
            color: #1a1a1a;
          }
          .event-meta {
            color: #6b7280;
            font-size: 12px;
            margin-top: 2px;
          }
          .footer {
            margin-top: 50px;
            text-align: center;
            font-size: 11px;
            color: #9ca3af;
            border-top: 1px solid #e5e7eb;
            padding-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${companyName}</h1>
          <p><strong>Contract Tracking Report</strong></p>
          <p>${new Date(from).toLocaleDateString()} - ${new Date(to).toLocaleDateString()}</p>
          <p>${contracts.length} contracts tracked</p>
        </div>

        ${contracts.map(contract => `
          <div class="contract-item">
            <div class="contract-header">
              <div class="contract-title">${contract.title}</div>
              <span class="contract-status status-${contract.status.toLowerCase()}">${contract.status}</span>
            </div>
            <div class="contract-meta">
              Created: ${new Date(contract.created_at).toLocaleString()}
              ${contract.completed_at ? ` | Completed: ${new Date(contract.completed_at).toLocaleString()}` : ''}
            </div>
            ${contract.events.length > 0 ? `
              <div class="events-timeline">
                <div class="events-title">Activity Timeline</div>
                ${contract.events.map(event => `
                  <div class="event-item">
                    <div class="event-icon"></div>
                    <div class="event-details">
                      <div class="event-type">${formatEventType(event.event_type)}</div>
                      <div class="event-meta">
                        ${event.recipient_email} • ${new Date(event.occurred_at).toLocaleString()}
                        ${event.ip_address ? ` • IP: ${event.ip_address}` : ''}
                      </div>
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `).join('')}

        <div class="footer">
          <p>Generated on ${new Date().toLocaleString()}</p>
          <p>${companyName} - Confidential Document</p>
        </div>
      </body>
    </html>
  `;
}

export function generateContractVolumeHTML(
  volumeData: ContractVolumeMetrics[],
  from: string,
  to: string,
  companyName: string
): string {
  const totalContracts = volumeData.reduce((sum, d) => sum + d.total, 0);
  const totalCompleted = volumeData.reduce((sum, d) => sum + d.completed, 0);
  const avgDaily = Math.round(totalContracts / volumeData.length);

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Contract Volume Report</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            margin: 40px;
            color: #1a1a1a;
            background: #fff;
          }
          .header {
            text-align: center;
            margin-bottom: 40px;
            border-bottom: 3px solid hsl(217, 91%, 60%);
            padding-bottom: 20px;
          }
          .header h1 {
            margin: 0;
            color: hsl(217, 91%, 60%);
            font-size: 28px;
            font-weight: 700;
          }
          .header p {
            margin: 8px 0;
            color: #666;
            font-size: 14px;
          }
          .summary-cards {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            margin-bottom: 40px;
          }
          .summary-card {
            padding: 24px;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            background: linear-gradient(135deg, #f9fafb 0%, #ffffff 100%);
            text-align: center;
          }
          .summary-label {
            font-size: 13px;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 600;
            margin-bottom: 12px;
          }
          .summary-value {
            font-size: 42px;
            font-weight: 700;
            color: hsl(217, 91%, 60%);
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
          }
          th, td {
            padding: 16px;
            text-align: left;
            border-bottom: 1px solid #e5e7eb;
          }
          th {
            background: hsl(217, 91%, 60%);
            color: white;
            font-weight: 700;
            text-transform: uppercase;
            font-size: 12px;
            letter-spacing: 0.5px;
          }
          tr:hover {
            background: #f9fafb;
          }
          .footer {
            margin-top: 50px;
            text-align: center;
            font-size: 11px;
            color: #9ca3af;
            border-top: 1px solid #e5e7eb;
            padding-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${companyName}</h1>
          <p><strong>Contract Volume Report</strong></p>
          <p>${new Date(from).toLocaleDateString()} - ${new Date(to).toLocaleDateString()}</p>
        </div>

        <div class="summary-cards">
          <div class="summary-card">
            <div class="summary-label">Total Contracts</div>
            <div class="summary-value">${totalContracts}</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">Completed</div>
            <div class="summary-value">${totalCompleted}</div>
          </div>
          <div class="summary-card">
            <div class="summary-label">Avg. Daily</div>
            <div class="summary-value">${avgDaily}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Total Created</th>
              <th>Sent</th>
              <th>Completed</th>
              <th>Completion Rate</th>
            </tr>
          </thead>
          <tbody>
            ${volumeData.map(day => `
              <tr>
                <td><strong>${new Date(day.date).toLocaleDateString()}</strong></td>
                <td>${day.total}</td>
                <td>${day.sent}</td>
                <td>${day.completed}</td>
                <td>${day.total > 0 ? Math.round((day.completed / day.total) * 100) : 0}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="footer">
          <p>Generated on ${new Date().toLocaleString()}</p>
          <p>${companyName} - Confidential Document</p>
        </div>
      </body>
    </html>
  `;
}

function formatEventType(eventType: string): string {
  const formatted = eventType
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  
  const icons: Record<string, string> = {
    'Envelope Created': '📄',
    'Envelope Sent': '📤',
    'Envelope Opened': '👁️',
    'Document Viewed': '📖',
    'Signature Requested': '✍️',
    'Signature Completed': '✅',
    'Envelope Completed': '🎉',
    'Envelope Voided': '🚫'
  };
  
  return `${icons[formatted] || '•'} ${formatted}`;
}
