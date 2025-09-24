export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      ai_insights: {
        Row: {
          action_taken: Json | null
          confidence_score: number | null
          context_id: string
          context_type: string
          created_at: string
          description: string
          expires_at: string | null
          id: string
          insight_type: string
          metadata: Json | null
          priority: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          action_taken?: Json | null
          confidence_score?: number | null
          context_id: string
          context_type: string
          created_at?: string
          description: string
          expires_at?: string | null
          id?: string
          insight_type: string
          metadata?: Json | null
          priority?: string
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          action_taken?: Json | null
          confidence_score?: number | null
          context_id?: string
          context_type?: string
          created_at?: string
          description?: string
          expires_at?: string | null
          id?: string
          insight_type?: string
          metadata?: Json | null
          priority?: string
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          created_at: string | null
          id: string
          setting_key: string
          setting_value: Json
          tenant_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          setting_key: string
          setting_value: Json
          tenant_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          setting_key?: string
          setting_value?: Json
          tenant_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          changed_at: string | null
          changed_by: string | null
          id: string
          ip_address: unknown | null
          new_values: Json | null
          old_values: Json | null
          record_id: string
          table_name: string
          tenant_id: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          changed_at?: string | null
          changed_by?: string | null
          id?: string
          ip_address?: unknown | null
          new_values?: Json | null
          old_values?: Json | null
          record_id: string
          table_name: string
          tenant_id?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          changed_at?: string | null
          changed_by?: string | null
          id?: string
          ip_address?: unknown | null
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string
          table_name?: string
          tenant_id?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          contact_id: string | null
          created_at: string
          created_by: string | null
          direction: string | null
          duration: number | null
          from_number: string | null
          id: string
          notes: string | null
          status: string | null
          tenant_id: string
          to_number: string | null
          updated_at: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string | null
          duration?: number | null
          from_number?: string | null
          id?: string
          notes?: string | null
          status?: string | null
          tenant_id: string
          to_number?: string | null
          updated_at?: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string | null
          duration?: number | null
          from_number?: string | null
          id?: string
          notes?: string | null
          status?: string | null
          tenant_id?: string
          to_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calls_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_plans: {
        Row: {
          commission_type: Database["public"]["Enums"]["commission_type"]
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          name: string
          plan_config: Json
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          commission_type: Database["public"]["Enums"]["commission_type"]
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          plan_config: Json
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          commission_type?: Database["public"]["Enums"]["commission_type"]
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          plan_config?: Json
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_plans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_history: {
        Row: {
          ai_insights: Json | null
          communication_type: string
          contact_id: string | null
          content: string | null
          created_at: string
          direction: string
          id: string
          metadata: Json | null
          pipeline_entry_id: string | null
          project_id: string | null
          rep_id: string | null
          sentiment_score: number | null
          subject: string | null
          tenant_id: string
          transcription: string | null
          updated_at: string
        }
        Insert: {
          ai_insights?: Json | null
          communication_type: string
          contact_id?: string | null
          content?: string | null
          created_at?: string
          direction: string
          id?: string
          metadata?: Json | null
          pipeline_entry_id?: string | null
          project_id?: string | null
          rep_id?: string | null
          sentiment_score?: number | null
          subject?: string | null
          tenant_id: string
          transcription?: string | null
          updated_at?: string
        }
        Update: {
          ai_insights?: Json | null
          communication_type?: string
          contact_id?: string | null
          content?: string | null
          created_at?: string
          direction?: string
          id?: string
          metadata?: Json | null
          pipeline_entry_id?: string | null
          project_id?: string | null
          rep_id?: string | null
          sentiment_score?: number | null
          subject?: string | null
          tenant_id?: string
          transcription?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "communication_history_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_history_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_history_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "communication_history_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          acquisition_cost: number | null
          address_city: string | null
          address_state: string | null
          address_street: string | null
          address_zip: string | null
          company_name: string | null
          created_at: string | null
          created_by: string | null
          email: string | null
          email_engagement_score: number | null
          first_name: string | null
          id: string
          last_name: string | null
          last_nurturing_activity: string | null
          last_scored_at: string | null
          latitude: number | null
          lead_score: number | null
          lead_source: string | null
          lead_source_details: Json | null
          longitude: number | null
          metadata: Json | null
          notes: string | null
          nurturing_status: string | null
          phone: string | null
          qualification_status: string | null
          referral_source: string | null
          scoring_details: Json | null
          tags: string[] | null
          tenant_id: string | null
          total_campaigns_completed: number | null
          type: Database["public"]["Enums"]["contact_type"] | null
          updated_at: string | null
        }
        Insert: {
          acquisition_cost?: number | null
          address_city?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          company_name?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          email_engagement_score?: number | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          last_nurturing_activity?: string | null
          last_scored_at?: string | null
          latitude?: number | null
          lead_score?: number | null
          lead_source?: string | null
          lead_source_details?: Json | null
          longitude?: number | null
          metadata?: Json | null
          notes?: string | null
          nurturing_status?: string | null
          phone?: string | null
          qualification_status?: string | null
          referral_source?: string | null
          scoring_details?: Json | null
          tags?: string[] | null
          tenant_id?: string | null
          total_campaigns_completed?: number | null
          type?: Database["public"]["Enums"]["contact_type"] | null
          updated_at?: string | null
        }
        Update: {
          acquisition_cost?: number | null
          address_city?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          company_name?: string | null
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          email_engagement_score?: number | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          last_nurturing_activity?: string | null
          last_scored_at?: string | null
          latitude?: number | null
          lead_score?: number | null
          lead_source?: string | null
          lead_source_details?: Json | null
          longitude?: number | null
          metadata?: Json | null
          notes?: string | null
          nurturing_status?: string | null
          phone?: string | null
          qualification_status?: string | null
          referral_source?: string | null
          scoring_details?: Json | null
          tags?: string[] | null
          tenant_id?: string | null
          total_campaigns_completed?: number | null
          type?: Database["public"]["Enums"]["contact_type"] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      developer_access_grants: {
        Row: {
          access_type: string | null
          developer_id: string
          granted_at: string | null
          granted_by: string | null
          id: string
          is_active: boolean | null
          tenant_id: string
        }
        Insert: {
          access_type?: string | null
          developer_id: string
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          is_active?: boolean | null
          tenant_id: string
        }
        Update: {
          access_type?: string | null
          developer_id?: string
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          is_active?: boolean | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "developer_access_grants_developer_id_fkey"
            columns: ["developer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "developer_access_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "developer_access_grants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      dialer_campaigns: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          list_id: string | null
          name: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          list_id?: string | null
          name: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          list_id?: string | null
          name?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dialer_campaigns_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "dialer_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      dialer_dispositions: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          is_positive: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_positive?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_positive?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      dialer_list_items: {
        Row: {
          created_at: string
          created_by: string | null
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          list_id: string
          metadata: Json | null
          phone: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          list_id: string
          metadata?: Json | null
          phone: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          list_id?: string
          metadata?: Json | null
          phone?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dialer_list_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "dialer_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      dialer_lists: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          total_items: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          tenant_id: string
          total_items?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          total_items?: number
          updated_at?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          contact_id: string | null
          created_at: string | null
          description: string | null
          document_type: string | null
          file_path: string
          file_size: number | null
          filename: string
          id: string
          is_visible_to_homeowner: boolean | null
          mime_type: string | null
          project_id: string | null
          tenant_id: string | null
          updated_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string | null
          description?: string | null
          document_type?: string | null
          file_path: string
          file_size?: number | null
          filename: string
          id?: string
          is_visible_to_homeowner?: boolean | null
          mime_type?: string | null
          project_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string | null
          description?: string | null
          document_type?: string | null
          file_path?: string
          file_size?: number | null
          filename?: string
          id?: string
          is_visible_to_homeowner?: boolean | null
          mime_type?: string | null
          project_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          name: string
          roof_type: Database["public"]["Enums"]["roof_type"]
          template_data: Json
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          roof_type: Database["public"]["Enums"]["roof_type"]
          template_data: Json
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          roof_type?: Database["public"]["Enums"]["roof_type"]
          template_data?: Json
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estimate_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      estimates: {
        Row: {
          actual_margin_percent: number | null
          actual_profit: number | null
          approved_at: string | null
          created_at: string | null
          created_by: string | null
          estimate_number: string | null
          id: string
          labor_cost: number | null
          line_items: Json | null
          material_cost: number | null
          overhead_amount: number | null
          overhead_percent: number | null
          parameters: Json | null
          pipeline_entry_id: string | null
          project_id: string | null
          selling_price: number | null
          sent_at: string | null
          status: Database["public"]["Enums"]["estimate_status"] | null
          target_margin_percent: number | null
          template_id: string | null
          tenant_id: string | null
          updated_at: string | null
          valid_until: string | null
        }
        Insert: {
          actual_margin_percent?: number | null
          actual_profit?: number | null
          approved_at?: string | null
          created_at?: string | null
          created_by?: string | null
          estimate_number?: string | null
          id?: string
          labor_cost?: number | null
          line_items?: Json | null
          material_cost?: number | null
          overhead_amount?: number | null
          overhead_percent?: number | null
          parameters?: Json | null
          pipeline_entry_id?: string | null
          project_id?: string | null
          selling_price?: number | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["estimate_status"] | null
          target_margin_percent?: number | null
          template_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          valid_until?: string | null
        }
        Update: {
          actual_margin_percent?: number | null
          actual_profit?: number | null
          approved_at?: string | null
          created_at?: string | null
          created_by?: string | null
          estimate_number?: string | null
          id?: string
          labor_cost?: number | null
          line_items?: Json | null
          material_cost?: number | null
          overhead_amount?: number | null
          overhead_percent?: number | null
          parameters?: Json | null
          pipeline_entry_id?: string | null
          project_id?: string | null
          selling_price?: number | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["estimate_status"] | null
          target_margin_percent?: number | null
          template_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estimates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "estimate_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_permissions: {
        Row: {
          created_at: string
          feature_key: string
          id: string
          is_enabled: boolean
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          feature_key: string
          id?: string
          is_enabled?: boolean
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          feature_key?: string
          id?: string
          is_enabled?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      follow_up_campaigns: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          sequence_steps: Json
          tenant_id: string
          trigger_conditions: Json
          trigger_event: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          sequence_steps?: Json
          tenant_id: string
          trigger_conditions?: Json
          trigger_event: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          sequence_steps?: Json
          tenant_id?: string
          trigger_conditions?: Json
          trigger_event?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_up_instances: {
        Row: {
          campaign_id: string | null
          contact_id: string | null
          created_at: string
          delivery_status: Json | null
          id: string
          pipeline_entry_id: string | null
          response_data: Json | null
          scheduled_for: string
          sent_at: string | null
          status: string
          step_index: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          campaign_id?: string | null
          contact_id?: string | null
          created_at?: string
          delivery_status?: Json | null
          id?: string
          pipeline_entry_id?: string | null
          response_data?: Json | null
          scheduled_for: string
          sent_at?: string | null
          status?: string
          step_index: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string | null
          contact_id?: string | null
          created_at?: string
          delivery_status?: Json | null
          id?: string
          pipeline_entry_id?: string | null
          response_data?: Json | null
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          step_index?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_instances_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "follow_up_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_instances_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_instances_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      idempotency_keys: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          key: string
          request_hash: string
          response_data: Json | null
          status_code: number | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          key: string
          request_hash: string
          response_data?: Json | null
          status_code?: number | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          key?: string
          request_hash?: string
          response_data?: Json | null
          status_code?: number | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "idempotency_keys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_qualification_statuses: {
        Row: {
          auto_assign: boolean | null
          color: string | null
          created_at: string
          created_by: string | null
          default_assigned_user: string | null
          id: string
          is_active: boolean | null
          max_score: number
          min_score: number
          name: string
          priority: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          auto_assign?: boolean | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          default_assigned_user?: string | null
          id?: string
          is_active?: boolean | null
          max_score?: number
          min_score?: number
          name: string
          priority?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          auto_assign?: boolean | null
          color?: string | null
          created_at?: string
          created_by?: string | null
          default_assigned_user?: string | null
          id?: string
          is_active?: boolean | null
          max_score?: number
          min_score?: number
          name?: string
          priority?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      lead_scoring_history: {
        Row: {
          contact_id: string | null
          id: string
          new_score: number | null
          old_score: number | null
          reason: string | null
          rule_applied: string | null
          score_change: number | null
          scored_at: string
          scored_by: string | null
          tenant_id: string
        }
        Insert: {
          contact_id?: string | null
          id?: string
          new_score?: number | null
          old_score?: number | null
          reason?: string | null
          rule_applied?: string | null
          score_change?: number | null
          scored_at?: string
          scored_by?: string | null
          tenant_id: string
        }
        Update: {
          contact_id?: string | null
          id?: string
          new_score?: number | null
          old_score?: number | null
          reason?: string | null
          rule_applied?: string | null
          score_change?: number | null
          scored_at?: string
          scored_by?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_scoring_history_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_scoring_rules: {
        Row: {
          condition_type: string
          condition_value: Json
          created_at: string
          created_by: string | null
          field_name: string
          id: string
          is_active: boolean | null
          points: number
          rule_name: string
          rule_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          condition_type: string
          condition_value?: Json
          created_at?: string
          created_by?: string | null
          field_name: string
          id?: string
          is_active?: boolean | null
          points?: number
          rule_name: string
          rule_type: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          condition_type?: string
          condition_value?: Json
          created_at?: string
          created_by?: string | null
          field_name?: string
          id?: string
          is_active?: boolean | null
          points?: number
          rule_name?: string
          rule_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      lead_source_performance: {
        Row: {
          appointments_set: number | null
          created_at: string
          deals_closed: number | null
          estimates_created: number | null
          id: string
          lead_source_id: string | null
          leads_generated: number | null
          period_end: string
          period_start: string
          qualified_leads: number | null
          roi_percent: number | null
          tenant_id: string
          total_cost: number | null
          total_revenue: number | null
          updated_at: string
        }
        Insert: {
          appointments_set?: number | null
          created_at?: string
          deals_closed?: number | null
          estimates_created?: number | null
          id?: string
          lead_source_id?: string | null
          leads_generated?: number | null
          period_end: string
          period_start: string
          qualified_leads?: number | null
          roi_percent?: number | null
          tenant_id: string
          total_cost?: number | null
          total_revenue?: number | null
          updated_at?: string
        }
        Update: {
          appointments_set?: number | null
          created_at?: string
          deals_closed?: number | null
          estimates_created?: number | null
          id?: string
          lead_source_id?: string | null
          leads_generated?: number | null
          period_end?: string
          period_start?: string
          qualified_leads?: number | null
          roi_percent?: number | null
          tenant_id?: string
          total_cost?: number | null
          total_revenue?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_source_performance_lead_source_id_fkey"
            columns: ["lead_source_id"]
            isOneToOne: false
            referencedRelation: "lead_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_sources: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          default_acquisition_cost: number | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          tenant_id: string
          tracking_url: string | null
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          created_by?: string | null
          default_acquisition_cost?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          tenant_id: string
          tracking_url?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          default_acquisition_cost?: number | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          tenant_id?: string
          tracking_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      message_templates: {
        Row: {
          category: string | null
          content: string
          created_at: string
          created_by: string | null
          id: string
          is_system_template: boolean | null
          name: string
          subject: string | null
          template_type: string
          tenant_id: string
          updated_at: string
          usage_count: number | null
          variables: Json | null
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_system_template?: boolean | null
          name: string
          subject?: string | null
          template_type: string
          tenant_id: string
          updated_at?: string
          usage_count?: number | null
          variables?: Json | null
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_system_template?: boolean | null
          name?: string
          subject?: string | null
          template_type?: string
          tenant_id?: string
          updated_at?: string
          usage_count?: number | null
          variables?: Json | null
        }
        Relationships: []
      }
      nurturing_campaign_steps: {
        Row: {
          campaign_id: string | null
          conditions: Json | null
          content_template: string | null
          content_variables: Json | null
          created_at: string
          delay_hours: number
          failure_count: number | null
          id: string
          is_active: boolean | null
          step_name: string
          step_order: number
          step_type: string
          success_count: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          campaign_id?: string | null
          conditions?: Json | null
          content_template?: string | null
          content_variables?: Json | null
          created_at?: string
          delay_hours?: number
          failure_count?: number | null
          id?: string
          is_active?: boolean | null
          step_name: string
          step_order: number
          step_type: string
          success_count?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string | null
          conditions?: Json | null
          content_template?: string | null
          content_variables?: Json | null
          created_at?: string
          delay_hours?: number
          failure_count?: number | null
          id?: string
          is_active?: boolean | null
          step_name?: string
          step_order?: number
          step_type?: string
          success_count?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nurturing_campaign_steps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "nurturing_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      nurturing_campaigns: {
        Row: {
          conversion_rate: number | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          priority: number | null
          target_audience: Json
          tenant_id: string
          total_completed: number | null
          total_enrolled: number | null
          trigger_conditions: Json
          trigger_type: string
          updated_at: string
        }
        Insert: {
          conversion_rate?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          priority?: number | null
          target_audience?: Json
          tenant_id: string
          total_completed?: number | null
          total_enrolled?: number | null
          trigger_conditions?: Json
          trigger_type: string
          updated_at?: string
        }
        Update: {
          conversion_rate?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          priority?: number | null
          target_audience?: Json
          tenant_id?: string
          total_completed?: number | null
          total_enrolled?: number | null
          trigger_conditions?: Json
          trigger_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      nurturing_enrollments: {
        Row: {
          campaign_id: string | null
          completion_date: string | null
          contact_id: string | null
          conversion_date: string | null
          converted: boolean | null
          created_at: string
          current_step_id: string | null
          enrollment_date: string
          id: string
          metadata: Json | null
          next_action_date: string | null
          status: string
          tenant_id: string
          total_steps_completed: number | null
          updated_at: string
        }
        Insert: {
          campaign_id?: string | null
          completion_date?: string | null
          contact_id?: string | null
          conversion_date?: string | null
          converted?: boolean | null
          created_at?: string
          current_step_id?: string | null
          enrollment_date?: string
          id?: string
          metadata?: Json | null
          next_action_date?: string | null
          status?: string
          tenant_id: string
          total_steps_completed?: number | null
          updated_at?: string
        }
        Update: {
          campaign_id?: string | null
          completion_date?: string | null
          contact_id?: string | null
          conversion_date?: string | null
          converted?: boolean | null
          created_at?: string
          current_step_id?: string | null
          enrollment_date?: string
          id?: string
          metadata?: Json | null
          next_action_date?: string | null
          status?: string
          tenant_id?: string
          total_steps_completed?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nurturing_enrollments_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "nurturing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nurturing_enrollments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nurturing_enrollments_current_step_id_fkey"
            columns: ["current_step_id"]
            isOneToOne: false
            referencedRelation: "nurturing_campaign_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      nurturing_step_executions: {
        Row: {
          created_at: string
          enrollment_id: string | null
          error_message: string | null
          executed_at: string
          id: string
          response_data: Json | null
          retry_count: number | null
          scheduled_for: string | null
          status: string
          step_id: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          enrollment_id?: string | null
          error_message?: string | null
          executed_at?: string
          id?: string
          response_data?: Json | null
          retry_count?: number | null
          scheduled_for?: string | null
          status?: string
          step_id?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          enrollment_id?: string | null
          error_message?: string | null
          executed_at?: string
          id?: string
          response_data?: Json | null
          retry_count?: number | null
          scheduled_for?: string | null
          status?: string
          step_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nurturing_step_executions_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "nurturing_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nurturing_step_executions_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "nurturing_campaign_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      outbox_events: {
        Row: {
          aggregate_id: string
          created_at: string | null
          error_message: string | null
          event_type: string
          id: string
          idempotency_key: string | null
          max_retries: number | null
          next_retry_at: string | null
          payload: Json
          processed_at: string | null
          retry_count: number | null
          status: Database["public"]["Enums"]["outbox_status"] | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          aggregate_id: string
          created_at?: string | null
          error_message?: string | null
          event_type: string
          id?: string
          idempotency_key?: string | null
          max_retries?: number | null
          next_retry_at?: string | null
          payload: Json
          processed_at?: string | null
          retry_count?: number | null
          status?: Database["public"]["Enums"]["outbox_status"] | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          aggregate_id?: string
          created_at?: string | null
          error_message?: string | null
          event_type?: string
          id?: string
          idempotency_key?: string | null
          max_retries?: number | null
          next_retry_at?: string | null
          payload?: Json
          processed_at?: string | null
          retry_count?: number | null
          status?: Database["public"]["Enums"]["outbox_status"] | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outbox_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string | null
          created_by: string | null
          customer_email: string | null
          description: string | null
          estimate_id: string | null
          id: string
          metadata: Json | null
          payment_method: string | null
          payment_number: string | null
          processed_at: string | null
          project_id: string | null
          provider_name: string | null
          provider_payment_id: string | null
          status: Database["public"]["Enums"]["payment_status"] | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          created_by?: string | null
          customer_email?: string | null
          description?: string | null
          estimate_id?: string | null
          id?: string
          metadata?: Json | null
          payment_method?: string | null
          payment_number?: string | null
          processed_at?: string | null
          project_id?: string | null
          provider_name?: string | null
          provider_payment_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"] | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          created_by?: string | null
          customer_email?: string | null
          description?: string | null
          estimate_id?: string | null
          id?: string
          metadata?: Json | null
          payment_method?: string | null
          payment_number?: string | null
          processed_at?: string | null
          project_id?: string | null
          provider_name?: string | null
          provider_payment_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"] | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_entries: {
        Row: {
          assigned_to: string | null
          contact_id: string | null
          conversion_probability: number | null
          created_at: string | null
          created_by: string | null
          disqualification_reason: string | null
          estimated_value: number | null
          expected_close_date: string | null
          id: string
          lead_quality_score: number | null
          lead_temperature: string | null
          marketing_campaign: string | null
          metadata: Json | null
          notes: string | null
          priority: string | null
          probability_percent: number | null
          qualification_notes: string | null
          roof_type: Database["public"]["Enums"]["roof_type"] | null
          source: Database["public"]["Enums"]["lead_source"] | null
          status: Database["public"]["Enums"]["pipeline_status"] | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          contact_id?: string | null
          conversion_probability?: number | null
          created_at?: string | null
          created_by?: string | null
          disqualification_reason?: string | null
          estimated_value?: number | null
          expected_close_date?: string | null
          id?: string
          lead_quality_score?: number | null
          lead_temperature?: string | null
          marketing_campaign?: string | null
          metadata?: Json | null
          notes?: string | null
          priority?: string | null
          probability_percent?: number | null
          qualification_notes?: string | null
          roof_type?: Database["public"]["Enums"]["roof_type"] | null
          source?: Database["public"]["Enums"]["lead_source"] | null
          status?: Database["public"]["Enums"]["pipeline_status"] | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          contact_id?: string | null
          conversion_probability?: number | null
          created_at?: string | null
          created_by?: string | null
          disqualification_reason?: string | null
          estimated_value?: number | null
          expected_close_date?: string | null
          id?: string
          lead_quality_score?: number | null
          lead_temperature?: string | null
          marketing_campaign?: string | null
          metadata?: Json | null
          notes?: string | null
          priority?: string | null
          probability_percent?: number | null
          qualification_notes?: string | null
          roof_type?: Database["public"]["Enums"]["roof_type"] | null
          source?: Database["public"]["Enums"]["lead_source"] | null
          status?: Database["public"]["Enums"]["pipeline_status"] | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_entries_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_entries_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_access_grants: {
        Row: {
          access_token: string
          contact_id: string | null
          created_at: string | null
          expires_at: string | null
          granted_by: string | null
          id: string
          is_active: boolean | null
          project_id: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          access_token: string
          contact_id?: string | null
          created_at?: string | null
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          is_active?: boolean | null
          project_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          access_token?: string
          contact_id?: string | null
          created_at?: string | null
          expires_at?: string | null
          granted_by?: string | null
          id?: string
          is_active?: boolean | null
          project_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_access_grants_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_access_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_access_grants_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_access_grants_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company_name: string | null
          created_at: string | null
          email: string | null
          first_name: string | null
          id: string
          is_active: boolean | null
          is_developer: boolean | null
          last_name: string | null
          metadata: Json | null
          phone: string | null
          role: Database["public"]["Enums"]["app_role"] | null
          tenant_id: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          company_name?: string | null
          created_at?: string | null
          email?: string | null
          first_name?: string | null
          id: string
          is_active?: boolean | null
          is_developer?: boolean | null
          last_name?: string | null
          metadata?: Json | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
          tenant_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          company_name?: string | null
          created_at?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean | null
          is_developer?: boolean | null
          last_name?: string | null
          metadata?: Json | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
          tenant_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_budget_snapshots: {
        Row: {
          created_at: string | null
          created_by: string | null
          estimate_id: string | null
          id: string
          is_current: boolean | null
          original_budget: Json
          project_id: string | null
          snapshot_date: string | null
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          estimate_id?: string | null
          id?: string
          is_current?: boolean | null
          original_budget: Json
          project_id?: string | null
          snapshot_date?: string | null
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          estimate_id?: string | null
          id?: string
          is_current?: boolean | null
          original_budget?: Json
          project_id?: string | null
          snapshot_date?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_budget_snapshots_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_budget_snapshots_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_budget_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_budget_snapshots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_costs: {
        Row: {
          cost_date: string | null
          cost_type: string
          created_at: string | null
          created_by: string | null
          description: string
          id: string
          invoice_number: string | null
          is_change_order: boolean | null
          notes: string | null
          project_id: string | null
          quantity: number | null
          receipt_url: string | null
          tenant_id: string | null
          total_cost: number
          unit_cost: number | null
          updated_at: string | null
          vendor_name: string | null
        }
        Insert: {
          cost_date?: string | null
          cost_type: string
          created_at?: string | null
          created_by?: string | null
          description: string
          id?: string
          invoice_number?: string | null
          is_change_order?: boolean | null
          notes?: string | null
          project_id?: string | null
          quantity?: number | null
          receipt_url?: string | null
          tenant_id?: string | null
          total_cost: number
          unit_cost?: number | null
          updated_at?: string | null
          vendor_name?: string | null
        }
        Update: {
          cost_date?: string | null
          cost_type?: string
          created_at?: string | null
          created_by?: string | null
          description?: string
          id?: string
          invoice_number?: string | null
          is_change_order?: boolean | null
          notes?: string | null
          project_id?: string | null
          quantity?: number | null
          receipt_url?: string | null
          tenant_id?: string | null
          total_cost?: number
          unit_cost?: number | null
          updated_at?: string | null
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_costs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_costs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_costs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          actual_completion_date: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          estimated_completion_date: string | null
          id: string
          metadata: Json | null
          name: string
          pipeline_entry_id: string | null
          project_manager_id: string | null
          project_number: string | null
          start_date: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          actual_completion_date?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          estimated_completion_date?: string | null
          id?: string
          metadata?: Json | null
          name: string
          pipeline_entry_id?: string | null
          project_manager_id?: string | null
          project_number?: string | null
          start_date?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          actual_completion_date?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          estimated_completion_date?: string | null
          id?: string
          metadata?: Json | null
          name?: string
          pipeline_entry_id?: string | null
          project_manager_id?: string | null
          project_number?: string | null
          start_date?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_project_manager_id_fkey"
            columns: ["project_manager_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rep_overhead_rules: {
        Row: {
          created_at: string | null
          created_by: string | null
          effective_date: string | null
          expires_date: string | null
          id: string
          is_active: boolean | null
          overhead_percent: number
          rep_id: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          effective_date?: string | null
          expires_date?: string | null
          id?: string
          is_active?: boolean | null
          overhead_percent: number
          rep_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          effective_date?: string | null
          expires_date?: string | null
          id?: string
          is_active?: boolean | null
          overhead_percent?: number
          rep_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rep_overhead_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rep_overhead_rules_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rep_overhead_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      smartdoc_assets: {
        Row: {
          content_type: string
          created_at: string
          created_by: string | null
          file_size: number | null
          hash: string | null
          height: number | null
          id: string
          name: string
          s3_key: string
          tenant_id: string
          width: number | null
        }
        Insert: {
          content_type: string
          created_at?: string
          created_by?: string | null
          file_size?: number | null
          hash?: string | null
          height?: number | null
          id?: string
          name: string
          s3_key: string
          tenant_id: string
          width?: number | null
        }
        Update: {
          content_type?: string
          created_at?: string
          created_by?: string | null
          file_size?: number | null
          hash?: string | null
          height?: number | null
          id?: string
          name?: string
          s3_key?: string
          tenant_id?: string
          width?: number | null
        }
        Relationships: []
      }
      smartdoc_blocks: {
        Row: {
          block_type: string
          content: Json
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_global: boolean | null
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          block_type: string
          content: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_global?: boolean | null
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          block_type?: string
          content?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_global?: boolean | null
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      smartdoc_folders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          parent_id: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          parent_id?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "smartdoc_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "smartdoc_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      smartdoc_renditions: {
        Row: {
          context_id: string
          context_type: Database["public"]["Enums"]["smartdoc_context_type"]
          created_at: string
          created_by: string | null
          error_message: string | null
          file_size: number | null
          id: string
          output_type: Database["public"]["Enums"]["smartdoc_output_type"]
          render_ms: number | null
          s3_key: string | null
          status: Database["public"]["Enums"]["smartdoc_render_status"]
          template_id: string
          template_version_id: string
          tenant_id: string
        }
        Insert: {
          context_id: string
          context_type: Database["public"]["Enums"]["smartdoc_context_type"]
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          file_size?: number | null
          id?: string
          output_type: Database["public"]["Enums"]["smartdoc_output_type"]
          render_ms?: number | null
          s3_key?: string | null
          status?: Database["public"]["Enums"]["smartdoc_render_status"]
          template_id: string
          template_version_id: string
          tenant_id: string
        }
        Update: {
          context_id?: string
          context_type?: Database["public"]["Enums"]["smartdoc_context_type"]
          created_at?: string
          created_by?: string | null
          error_message?: string | null
          file_size?: number | null
          id?: string
          output_type?: Database["public"]["Enums"]["smartdoc_output_type"]
          render_ms?: number | null
          s3_key?: string | null
          status?: Database["public"]["Enums"]["smartdoc_render_status"]
          template_id?: string
          template_version_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "smartdoc_renditions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "smartdoc_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "smartdoc_renditions_template_version_id_fkey"
            columns: ["template_version_id"]
            isOneToOne: false
            referencedRelation: "smartdoc_template_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      smartdoc_share_rules: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_portal_visible: boolean | null
          rendition_id: string | null
          require_auth: boolean | null
          template_id: string | null
          tenant_id: string
          watermark_text: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_portal_visible?: boolean | null
          rendition_id?: string | null
          require_auth?: boolean | null
          template_id?: string | null
          tenant_id: string
          watermark_text?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_portal_visible?: boolean | null
          rendition_id?: string | null
          require_auth?: boolean | null
          template_id?: string | null
          tenant_id?: string
          watermark_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "smartdoc_share_rules_rendition_id_fkey"
            columns: ["rendition_id"]
            isOneToOne: false
            referencedRelation: "smartdoc_renditions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "smartdoc_share_rules_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "smartdoc_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      smartdoc_sign_envelopes: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          envelope_id: string | null
          id: string
          provider: Database["public"]["Enums"]["smartdoc_sign_provider"]
          rendition_id: string
          signer_roles: Json
          signing_url: string | null
          status: Database["public"]["Enums"]["smartdoc_sign_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          envelope_id?: string | null
          id?: string
          provider: Database["public"]["Enums"]["smartdoc_sign_provider"]
          rendition_id: string
          signer_roles: Json
          signing_url?: string | null
          status?: Database["public"]["Enums"]["smartdoc_sign_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          envelope_id?: string | null
          id?: string
          provider?: Database["public"]["Enums"]["smartdoc_sign_provider"]
          rendition_id?: string
          signer_roles?: Json
          signing_url?: string | null
          status?: Database["public"]["Enums"]["smartdoc_sign_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "smartdoc_sign_envelopes_rendition_id_fkey"
            columns: ["rendition_id"]
            isOneToOne: false
            referencedRelation: "smartdoc_renditions"
            referencedColumns: ["id"]
          },
        ]
      }
      smartdoc_tag_catalog: {
        Row: {
          context_type: Database["public"]["Enums"]["smartdoc_context_type"]
          created_at: string
          description: string
          example_value: string | null
          id: string
          is_sensitive: boolean | null
          name: string
          tenant_id: string | null
          transform_support: string[] | null
        }
        Insert: {
          context_type: Database["public"]["Enums"]["smartdoc_context_type"]
          created_at?: string
          description: string
          example_value?: string | null
          id?: string
          is_sensitive?: boolean | null
          name: string
          tenant_id?: string | null
          transform_support?: string[] | null
        }
        Update: {
          context_type?: Database["public"]["Enums"]["smartdoc_context_type"]
          created_at?: string
          description?: string
          example_value?: string | null
          id?: string
          is_sensitive?: boolean | null
          name?: string
          tenant_id?: string | null
          transform_support?: string[] | null
        }
        Relationships: []
      }
      smartdoc_template_versions: {
        Row: {
          changelog: string | null
          created_at: string
          engine: Database["public"]["Enums"]["smartdoc_engine"]
          id: string
          is_latest: boolean | null
          published_at: string | null
          published_by: string | null
          schema: Json
          template_id: string
          tenant_id: string
          version: number
        }
        Insert: {
          changelog?: string | null
          created_at?: string
          engine?: Database["public"]["Enums"]["smartdoc_engine"]
          id?: string
          is_latest?: boolean | null
          published_at?: string | null
          published_by?: string | null
          schema: Json
          template_id: string
          tenant_id: string
          version?: number
        }
        Update: {
          changelog?: string | null
          created_at?: string
          engine?: Database["public"]["Enums"]["smartdoc_engine"]
          id?: string
          is_latest?: boolean | null
          published_at?: string | null
          published_by?: string | null
          schema?: Json
          template_id?: string
          tenant_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "smartdoc_template_versions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "smartdoc_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      smartdoc_templates: {
        Row: {
          created_at: string
          created_by: string | null
          default_context: Database["public"]["Enums"]["smartdoc_context_type"]
          description: string | null
          folder_id: string | null
          id: string
          is_homeowner_visible: boolean | null
          name: string
          status: Database["public"]["Enums"]["smartdoc_status"]
          tenant_id: string
          type: Database["public"]["Enums"]["smartdoc_template_type"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_context?: Database["public"]["Enums"]["smartdoc_context_type"]
          description?: string | null
          folder_id?: string | null
          id?: string
          is_homeowner_visible?: boolean | null
          name: string
          status?: Database["public"]["Enums"]["smartdoc_status"]
          tenant_id: string
          type?: Database["public"]["Enums"]["smartdoc_template_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_context?: Database["public"]["Enums"]["smartdoc_context_type"]
          description?: string | null
          folder_id?: string | null
          id?: string
          is_homeowner_visible?: boolean | null
          name?: string
          status?: Database["public"]["Enums"]["smartdoc_status"]
          tenant_id?: string
          type?: Database["public"]["Enums"]["smartdoc_template_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_smartdoc_templates_folder"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "smartdoc_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_pricebooks: {
        Row: {
          category: string | null
          created_at: string | null
          effective_date: string | null
          expires_date: string | null
          id: string
          imported_at: string | null
          is_active: boolean | null
          item_code: string
          item_description: string | null
          markup_percent: number | null
          metadata: Json | null
          supplier_name: string
          tenant_id: string | null
          unit_cost: number | null
          unit_of_measure: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          effective_date?: string | null
          expires_date?: string | null
          id?: string
          imported_at?: string | null
          is_active?: boolean | null
          item_code: string
          item_description?: string | null
          markup_percent?: number | null
          metadata?: Json | null
          supplier_name: string
          tenant_id?: string | null
          unit_cost?: number | null
          unit_of_measure?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          effective_date?: string | null
          expires_date?: string | null
          id?: string
          imported_at?: string | null
          is_active?: boolean | null
          item_code?: string
          item_description?: string | null
          markup_percent?: number | null
          metadata?: Json | null
          supplier_name?: string
          tenant_id?: string | null
          unit_cost?: number | null
          unit_of_measure?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_pricebooks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          ai_context: Json | null
          ai_generated: boolean | null
          assigned_to: string | null
          completed_at: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          metadata: Json | null
          pipeline_entry_id: string | null
          priority: string
          project_id: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          ai_context?: Json | null
          ai_generated?: boolean | null
          assigned_to?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          metadata?: Json | null
          pipeline_entry_id?: string | null
          priority?: string
          project_id?: string | null
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          ai_context?: Json | null
          ai_generated?: boolean | null
          assigned_to?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          metadata?: Json | null
          pipeline_entry_id?: string | null
          priority?: string
          project_id?: string | null
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_settings: {
        Row: {
          created_at: string | null
          default_target_margin_percent: number | null
          id: string
          min_profit_amount_dollars: number | null
          min_profit_margin_percent: number | null
          portal_show_balance: boolean | null
          portal_show_documents: boolean | null
          portal_show_messages: boolean | null
          portal_show_photos: boolean | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          default_target_margin_percent?: number | null
          id?: string
          min_profit_amount_dollars?: number | null
          min_profit_margin_percent?: number | null
          portal_show_balance?: boolean | null
          portal_show_documents?: boolean | null
          portal_show_messages?: boolean | null
          portal_show_photos?: boolean | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          default_target_margin_percent?: number | null
          id?: string
          min_profit_amount_dollars?: number | null
          min_profit_margin_percent?: number | null
          portal_show_balance?: boolean | null
          portal_show_documents?: boolean | null
          portal_show_messages?: boolean | null
          portal_show_photos?: boolean | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string | null
          id: string
          name: string
          settings: Json | null
          subdomain: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          settings?: Json | null
          subdomain?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          settings?: Json | null
          subdomain?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_commission_plans: {
        Row: {
          commission_plan_id: string | null
          created_at: string | null
          created_by: string | null
          effective_date: string | null
          expires_date: string | null
          id: string
          is_active: boolean | null
          tenant_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          commission_plan_id?: string | null
          created_at?: string | null
          created_by?: string | null
          effective_date?: string | null
          expires_date?: string | null
          id?: string
          is_active?: boolean | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          commission_plan_id?: string | null
          created_at?: string | null
          created_by?: string | null
          effective_date?: string | null
          expires_date?: string | null
          id?: string
          is_active?: boolean | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_commission_plans_commission_plan_id_fkey"
            columns: ["commission_plan_id"]
            isOneToOne: false
            referencedRelation: "commission_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_commission_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_commission_plans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_commission_plans_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      calculate_lead_score: {
        Args: { contact_data: Json; tenant_id_param: string }
        Returns: number
      }
      check_enrollment_eligibility: {
        Args: { campaign_conditions: Json; contact_data: Json }
        Returns: boolean
      }
      get_user_tenant_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      has_any_role: {
        Args: { required_roles: Database["public"]["Enums"]["app_role"][] }
        Returns: boolean
      }
      has_role: {
        Args: { required_role: Database["public"]["Enums"]["app_role"] }
        Returns: boolean
      }
      switch_developer_context: {
        Args: { target_tenant_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "master" | "admin" | "manager" | "rep" | "user"
      commission_type:
        | "gross_percent"
        | "net_percent"
        | "tiered_margin"
        | "flat_fee"
      contact_type:
        | "homeowner"
        | "contractor"
        | "supplier"
        | "inspector"
        | "other"
      estimate_status:
        | "draft"
        | "preview"
        | "sent"
        | "approved"
        | "rejected"
        | "expired"
      lead_source:
        | "referral"
        | "canvassing"
        | "online"
        | "advertisement"
        | "social_media"
        | "other"
      outbox_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
        | "canceled"
      payment_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
        | "refunded"
        | "canceled"
      pipeline_status:
        | "lead"
        | "legal_review"
        | "contingency_signed"
        | "project"
        | "completed"
        | "closed"
        | "lost"
        | "canceled"
        | "duplicate"
      roof_type:
        | "shingle"
        | "metal"
        | "tile"
        | "flat"
        | "slate"
        | "cedar"
        | "other"
      smartdoc_context_type:
        | "CONTACT"
        | "LEAD"
        | "PROJECT"
        | "ESTIMATE"
        | "INVOICE"
      smartdoc_engine: "HTML" | "DOCX" | "PDF_FORM"
      smartdoc_output_type: "PDF" | "DOCX" | "HTML"
      smartdoc_render_status: "PENDING" | "SUCCEEDED" | "FAILED"
      smartdoc_sign_provider: "DOCUSIGN" | "NATIVE"
      smartdoc_sign_status: "PENDING" | "COMPLETED" | "DECLINED" | "VOID"
      smartdoc_status: "DRAFT" | "PUBLISHED" | "ARCHIVED"
      smartdoc_template_type: "DOCUMENT" | "EMAIL" | "PRINT"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["master", "admin", "manager", "rep", "user"],
      commission_type: [
        "gross_percent",
        "net_percent",
        "tiered_margin",
        "flat_fee",
      ],
      contact_type: [
        "homeowner",
        "contractor",
        "supplier",
        "inspector",
        "other",
      ],
      estimate_status: [
        "draft",
        "preview",
        "sent",
        "approved",
        "rejected",
        "expired",
      ],
      lead_source: [
        "referral",
        "canvassing",
        "online",
        "advertisement",
        "social_media",
        "other",
      ],
      outbox_status: [
        "pending",
        "processing",
        "completed",
        "failed",
        "canceled",
      ],
      payment_status: [
        "pending",
        "processing",
        "completed",
        "failed",
        "refunded",
        "canceled",
      ],
      pipeline_status: [
        "lead",
        "legal_review",
        "contingency_signed",
        "project",
        "completed",
        "closed",
        "lost",
        "canceled",
        "duplicate",
      ],
      roof_type: [
        "shingle",
        "metal",
        "tile",
        "flat",
        "slate",
        "cedar",
        "other",
      ],
      smartdoc_context_type: [
        "CONTACT",
        "LEAD",
        "PROJECT",
        "ESTIMATE",
        "INVOICE",
      ],
      smartdoc_engine: ["HTML", "DOCX", "PDF_FORM"],
      smartdoc_output_type: ["PDF", "DOCX", "HTML"],
      smartdoc_render_status: ["PENDING", "SUCCEEDED", "FAILED"],
      smartdoc_sign_provider: ["DOCUSIGN", "NATIVE"],
      smartdoc_sign_status: ["PENDING", "COMPLETED", "DECLINED", "VOID"],
      smartdoc_status: ["DRAFT", "PUBLISHED", "ARCHIVED"],
      smartdoc_template_type: ["DOCUMENT", "EMAIL", "PRINT"],
    },
  },
} as const
