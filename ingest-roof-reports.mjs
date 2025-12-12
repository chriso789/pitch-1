/*
 * ingest-roof-reports.mjs
 *
 * This utility will bulk-ingest a directory of vendor roof measurement PDFs into your
 * Supabase project by leveraging the `roof-report-ingest` edge function you deploy.
 *
 * Usage:
 *   node ingest-roof-reports.mjs <path-to-directory>
 *
 * Environment variables required:
 *   - SUPABASE_URL                 : your Supabase project URL
 *   - SUPABASE_SERVICE_ROLE_KEY    : service role key (must have access to edge functions)
 *   - ROOF_REPORT_INGEST_ENDPOINT  : optional override for the ingest endpoint. If not provided
 *                                    this script will call `${SUPABASE_URL}/functions/v1/roof-report-ingest`.
 *
 * The script reads every PDF file in the provided directory, converts it into a base64
 * string, then issues a POST request to the ingest endpoint with the payload:
 *   {
 *     "file_name": "<pdf file name>",
 *     "base64_pdf": "<base64 encoded pdf>"
 *   }
 *
 * The ingest function is expected to store the PDF in Supabase Storage, extract
 * measurements, and populate the `roof_vendor_reports` and `roof_measurements_truth`
 * tables as defined in your migrations. The response from each call is logged
 * to stdout. In case of failure the error body is printed to stderr.
 */

import fs from 'fs';
import path from 'path';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  ROOF_REPORT_INGEST_ENDPOINT
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Missing required env vars. Please define SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.'
  );
  process.exit(1);
}

const ingestUrl =
  ROOF_REPORT_INGEST_ENDPOINT ||
  `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/roof-report-ingest`;

async function ingestPdfFile(filePath) {
  const fileName = path.basename(filePath);
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString('base64');
  const payload = {
    file_name: fileName,
    base64_pdf: base64
  };
  const res = await fetch(ingestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify(payload)
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Error ingesting ${fileName}:`, text);
  } else {
    try {
      const json = JSON.parse(text);
      console.log(`Ingested ${fileName}:`, JSON.stringify(json));
    } catch (err) {
      console.log(`Ingested ${fileName}:`, text);
    }
  }
}

async function ingestFolder(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'));
  for (const f of files) {
    const filePath = path.join(dir, f);
    await ingestPdfFile(filePath);
  }
}

const [directory] = process.argv.slice(2);
if (!directory) {
  console.error('Please provide a directory of PDF files to ingest.');
  process.exit(1);
}
ingestFolder(directory).catch((err) => {
  console.error('Unexpected error during ingestion:', err);
});