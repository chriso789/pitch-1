ALTER TABLE signature_envelopes
  ADD CONSTRAINT fk_signature_envelopes_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id);