-- SMART DOCS Database Schema - Phase 2: RLS Policies & Indexes
-- RLS Policies for Smart Docs tables

-- smartdoc_templates policies
CREATE POLICY "Users can view templates in their tenant" ON public.smartdoc_templates
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage templates in their tenant" ON public.smartdoc_templates
  FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- smartdoc_template_versions policies
CREATE POLICY "Users can view template versions in their tenant" ON public.smartdoc_template_versions
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage template versions in their tenant" ON public.smartdoc_template_versions
  FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- smartdoc_blocks policies
CREATE POLICY "Users can view blocks in their tenant" ON public.smartdoc_blocks
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage blocks in their tenant" ON public.smartdoc_blocks
  FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- smartdoc_assets policies
CREATE POLICY "Users can view assets in their tenant" ON public.smartdoc_assets
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage assets in their tenant" ON public.smartdoc_assets
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- smartdoc_tag_catalog policies (includes global tags)
CREATE POLICY "Users can view tag catalog" ON public.smartdoc_tag_catalog
  FOR SELECT USING (tenant_id IS NULL OR tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage tenant tag catalog" ON public.smartdoc_tag_catalog
  FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('master'::app_role)));

-- smartdoc_renditions policies
CREATE POLICY "Users can view renditions in their tenant" ON public.smartdoc_renditions
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create renditions in their tenant" ON public.smartdoc_renditions
  FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage renditions in their tenant" ON public.smartdoc_renditions
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- smartdoc_sign_envelopes policies
CREATE POLICY "Users can view sign envelopes in their tenant" ON public.smartdoc_sign_envelopes
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create sign envelopes in their tenant" ON public.smartdoc_sign_envelopes
  FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "System can update sign envelopes" ON public.smartdoc_sign_envelopes
  FOR UPDATE USING (tenant_id = get_user_tenant_id());

-- smartdoc_share_rules policies
CREATE POLICY "Users can view share rules in their tenant" ON public.smartdoc_share_rules
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage share rules in their tenant" ON public.smartdoc_share_rules
  FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- smartdoc_folders policies
CREATE POLICY "Users can view folders in their tenant" ON public.smartdoc_folders
  FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage folders in their tenant" ON public.smartdoc_folders
  FOR ALL USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

-- Create performance indexes
CREATE INDEX idx_smartdoc_templates_tenant_id ON public.smartdoc_templates(tenant_id);
CREATE INDEX idx_smartdoc_templates_status ON public.smartdoc_templates(status);
CREATE INDEX idx_smartdoc_template_versions_template_id ON public.smartdoc_template_versions(template_id);
CREATE INDEX idx_smartdoc_template_versions_latest ON public.smartdoc_template_versions(template_id, is_latest) WHERE is_latest = true;
CREATE INDEX idx_smartdoc_blocks_tenant_id ON public.smartdoc_blocks(tenant_id);
CREATE INDEX idx_smartdoc_blocks_type ON public.smartdoc_blocks(block_type);
CREATE INDEX idx_smartdoc_assets_tenant_id ON public.smartdoc_assets(tenant_id);
CREATE INDEX idx_smartdoc_tag_catalog_context ON public.smartdoc_tag_catalog(context_type);
CREATE INDEX idx_smartdoc_renditions_tenant_id ON public.smartdoc_renditions(tenant_id);
CREATE INDEX idx_smartdoc_renditions_context ON public.smartdoc_renditions(context_type, context_id);
CREATE INDEX idx_smartdoc_sign_envelopes_tenant_id ON public.smartdoc_sign_envelopes(tenant_id);
CREATE INDEX idx_smartdoc_sign_envelopes_status ON public.smartdoc_sign_envelopes(status);
CREATE INDEX idx_smartdoc_share_rules_tenant_id ON public.smartdoc_share_rules(tenant_id);
CREATE INDEX idx_smartdoc_folders_tenant_id ON public.smartdoc_folders(tenant_id);

-- Add updated_at triggers
CREATE TRIGGER update_smartdoc_templates_updated_at
  BEFORE UPDATE ON public.smartdoc_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_smartdoc_blocks_updated_at
  BEFORE UPDATE ON public.smartdoc_blocks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_smartdoc_sign_envelopes_updated_at
  BEFORE UPDATE ON public.smartdoc_sign_envelopes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Foreign key constraints
ALTER TABLE public.smartdoc_templates ADD CONSTRAINT fk_smartdoc_templates_folder 
  FOREIGN KEY (folder_id) REFERENCES public.smartdoc_folders(id);

-- Unique constraints
ALTER TABLE public.smartdoc_template_versions ADD CONSTRAINT unique_template_version 
  UNIQUE (template_id, version);

ALTER TABLE public.smartdoc_tag_catalog ADD CONSTRAINT unique_tag_name_context 
  UNIQUE (name, context_type, tenant_id);