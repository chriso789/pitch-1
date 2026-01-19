// =========================================================
// Permit Types
// =========================================================

export type MissingSeverity = "error" | "warning" | "info";

export type MissingItem = {
  key: string;
  severity: MissingSeverity;
  message: string;
};

export type PermitCaseRow = {
  id: string;
  tenant_id: string;
  job_id: string;
  estimate_id: string | null;
  authority_id: string | null;
  template_id: string | null;
  status: string;
};

export type TemplateRow = {
  id: string;
  tenant_id: string;
  authority_id: string;
  template_key: string;
  permit_type: string;
  version: number;
  template_json: any;
};

export type ValidationError = {
  key: string;
  severity: MissingSeverity;
  message: string;
};

export type PermitDocument = {
  id: string;
  kind: string;
  title: string;
  bucket: string;
  path: string;
  signed_url: string;
  content_type: string;
};

export type NextAction = {
  action: string;
  label: string;
  url?: string;
  items?: string[];
  when?: Record<string, any>;
};
