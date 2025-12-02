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
      achievement_rewards: {
        Row: {
          achievement_id: string | null
          claimed_at: string | null
          competition_id: string | null
          created_at: string
          delivered_at: string | null
          id: string
          notes: string | null
          processed_at: string | null
          recipient_address: Json | null
          recipient_email: string | null
          reward_metadata: Json | null
          reward_type: Database["public"]["Enums"]["reward_type"]
          reward_value: number
          sent_at: string | null
          status: Database["public"]["Enums"]["reward_status"]
          stripe_payment_intent_id: string | null
          tenant_id: string
          tracking_number: string | null
          user_id: string
        }
        Insert: {
          achievement_id?: string | null
          claimed_at?: string | null
          competition_id?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          notes?: string | null
          processed_at?: string | null
          recipient_address?: Json | null
          recipient_email?: string | null
          reward_metadata?: Json | null
          reward_type: Database["public"]["Enums"]["reward_type"]
          reward_value?: number
          sent_at?: string | null
          status?: Database["public"]["Enums"]["reward_status"]
          stripe_payment_intent_id?: string | null
          tenant_id: string
          tracking_number?: string | null
          user_id: string
        }
        Update: {
          achievement_id?: string | null
          claimed_at?: string | null
          competition_id?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          notes?: string | null
          processed_at?: string | null
          recipient_address?: Json | null
          recipient_email?: string | null
          reward_metadata?: Json | null
          reward_type?: Database["public"]["Enums"]["reward_type"]
          reward_value?: number
          sent_at?: string | null
          status?: Database["public"]["Enums"]["reward_status"]
          stripe_payment_intent_id?: string | null
          tenant_id?: string
          tracking_number?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "achievement_rewards_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "canvass_achievements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "achievement_rewards_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "canvass_competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_instances: {
        Row: {
          completed_at: string | null
          contact_id: string | null
          created_at: string | null
          crm_object_id: string | null
          crm_object_type: string | null
          email_subject: string | null
          envelope_custom_fields: Json | null
          envelope_id: string | null
          id: string
          metadata: Json | null
          pipeline_entry_id: string | null
          project_id: string | null
          sender_user_id: string | null
          sent_at: string | null
          status: string
          template_slug: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string | null
          crm_object_id?: string | null
          crm_object_type?: string | null
          email_subject?: string | null
          envelope_custom_fields?: Json | null
          envelope_id?: string | null
          id?: string
          metadata?: Json | null
          pipeline_entry_id?: string | null
          project_id?: string | null
          sender_user_id?: string | null
          sent_at?: string | null
          status?: string
          template_slug: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string | null
          crm_object_id?: string | null
          crm_object_type?: string | null
          email_subject?: string | null
          envelope_custom_fields?: Json | null
          envelope_id?: string | null
          id?: string
          metadata?: Json | null
          pipeline_entry_id?: string | null
          project_id?: string | null
          sender_user_id?: string | null
          sent_at?: string | null
          status?: string
          template_slug?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agreement_instances_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_instances_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agreement_instances_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      agreement_templates: {
        Row: {
          anchor_tag_strategy: Json | null
          created_at: string | null
          created_by: string | null
          description: string | null
          docgen_enabled: boolean | null
          docusign_template_id: string
          id: string
          is_active: boolean | null
          metadata: Json | null
          name: string
          recipient_roles: Json | null
          routing_order: number | null
          slug: string
          smart_doc_id: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          anchor_tag_strategy?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          docgen_enabled?: boolean | null
          docusign_template_id: string
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          name: string
          recipient_roles?: Json | null
          routing_order?: number | null
          slug: string
          smart_doc_id?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          anchor_tag_strategy?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          docgen_enabled?: boolean | null
          docusign_template_id?: string
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          name?: string
          recipient_roles?: Json | null
          routing_order?: number | null
          slug?: string
          smart_doc_id?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agreement_templates_smart_doc_id_fkey"
            columns: ["smart_doc_id"]
            isOneToOne: false
            referencedRelation: "smart_docs"
            referencedColumns: ["id"]
          },
        ]
      }
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
      ai_usage_metrics: {
        Row: {
          completion_tokens: number | null
          created_at: string
          endpoint: string | null
          error_message: string | null
          estimated_cost_usd: number | null
          feature: string
          id: string
          model: string
          prompt_tokens: number | null
          provider: string
          request_id: string | null
          response_time_ms: number | null
          status: string
          tenant_id: string | null
          total_tokens: number | null
          user_id: string | null
        }
        Insert: {
          completion_tokens?: number | null
          created_at?: string
          endpoint?: string | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          feature: string
          id?: string
          model: string
          prompt_tokens?: number | null
          provider: string
          request_id?: string | null
          response_time_ms?: number | null
          status: string
          tenant_id?: string | null
          total_tokens?: number | null
          user_id?: string | null
        }
        Update: {
          completion_tokens?: number | null
          created_at?: string
          endpoint?: string | null
          error_message?: string | null
          estimated_cost_usd?: number | null
          feature?: string
          id?: string
          model?: string
          prompt_tokens?: number | null
          provider?: string
          request_id?: string | null
          response_time_ms?: number | null
          status?: string
          tenant_id?: string | null
          total_tokens?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_metrics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      answered_calls_log: {
        Row: {
          answered_at: string | null
          caller_number: string
          disposition: string | null
          duration: number | null
          escalated_to_human: boolean | null
          id: string
          status: string
          tenant_id: string
          transcription: string | null
        }
        Insert: {
          answered_at?: string | null
          caller_number: string
          disposition?: string | null
          duration?: number | null
          escalated_to_human?: boolean | null
          id?: string
          status: string
          tenant_id: string
          transcription?: string | null
        }
        Update: {
          answered_at?: string | null
          caller_number?: string
          disposition?: string | null
          duration?: number | null
          escalated_to_human?: boolean | null
          id?: string
          status?: string
          tenant_id?: string
          transcription?: string | null
        }
        Relationships: []
      }
      answering_service_config: {
        Row: {
          created_at: string | null
          custom_greeting: string | null
          id: string
          is_active: boolean
          tenant_id: string
          updated_at: string | null
          voice_settings: Json | null
        }
        Insert: {
          created_at?: string | null
          custom_greeting?: string | null
          id?: string
          is_active?: boolean
          tenant_id: string
          updated_at?: string | null
          voice_settings?: Json | null
        }
        Update: {
          created_at?: string | null
          custom_greeting?: string | null
          id?: string
          is_active?: boolean
          tenant_id?: string
          updated_at?: string | null
          voice_settings?: Json | null
        }
        Relationships: []
      }
      api_rate_limits: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          tenant_id?: string
          user_id?: string
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
      asterisk_channels: {
        Row: {
          agent_id: string | null
          call_log_id: string | null
          channel_id: string
          contact_id: string | null
          id: string
          pipeline_entry_id: string | null
          started_at: string | null
          status: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          agent_id?: string | null
          call_log_id?: string | null
          channel_id: string
          contact_id?: string | null
          id?: string
          pipeline_entry_id?: string | null
          started_at?: string | null
          status?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          agent_id?: string | null
          call_log_id?: string | null
          channel_id?: string
          contact_id?: string | null
          id?: string
          pipeline_entry_id?: string | null
          started_at?: string | null
          status?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "asterisk_channels_call_log_id_fkey"
            columns: ["call_log_id"]
            isOneToOne: false
            referencedRelation: "call_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asterisk_channels_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asterisk_channels_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asterisk_channels_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          ip_address: unknown
          location_data: Json | null
          new_values: Json | null
          old_values: Json | null
          record_id: string
          session_id: string | null
          table_name: string
          tenant_id: string | null
          user_agent: string | null
          user_location: Json | null
        }
        Insert: {
          action: string
          changed_at?: string | null
          changed_by?: string | null
          id?: string
          ip_address?: unknown
          location_data?: Json | null
          new_values?: Json | null
          old_values?: Json | null
          record_id: string
          session_id?: string | null
          table_name: string
          tenant_id?: string | null
          user_agent?: string | null
          user_location?: Json | null
        }
        Update: {
          action?: string
          changed_at?: string | null
          changed_by?: string | null
          id?: string
          ip_address?: unknown
          location_data?: Json | null
          new_values?: Json | null
          old_values?: Json | null
          record_id?: string
          session_id?: string | null
          table_name?: string
          tenant_id?: string | null
          user_agent?: string | null
          user_location?: Json | null
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
      automation_logs: {
        Row: {
          automation_id: string
          error_message: string | null
          execution_result: Json | null
          id: string
          status: string | null
          tenant_id: string
          trigger_data: Json | null
          triggered_at: string | null
        }
        Insert: {
          automation_id: string
          error_message?: string | null
          execution_result?: Json | null
          id?: string
          status?: string | null
          tenant_id?: string
          trigger_data?: Json | null
          triggered_at?: string | null
        }
        Update: {
          automation_id?: string
          error_message?: string | null
          execution_result?: Json | null
          id?: string
          status?: string | null
          tenant_id?: string
          trigger_data?: Json | null
          triggered_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_logs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          created_at: string | null
          created_by: string | null
          delay_minutes: number | null
          description: string | null
          execution_count: number | null
          id: string
          is_active: boolean | null
          last_executed_at: string | null
          name: string
          recipient_rules: Json | null
          template_id: string | null
          tenant_id: string
          trigger_conditions: Json | null
          trigger_event: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          delay_minutes?: number | null
          description?: string | null
          execution_count?: number | null
          id?: string
          is_active?: boolean | null
          last_executed_at?: string | null
          name: string
          recipient_rules?: Json | null
          template_id?: string | null
          tenant_id: string
          trigger_conditions?: Json | null
          trigger_event: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          delay_minutes?: number | null
          description?: string | null
          execution_count?: number | null
          id?: string
          is_active?: boolean | null
          last_executed_at?: string | null
          name?: string
          recipient_rules?: Json | null
          template_id?: string | null
          tenant_id?: string
          trigger_conditions?: Json | null
          trigger_event?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_rules_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "notification_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          actions: Json | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          tenant_id: string
          trigger_conditions: Json | null
          trigger_type: string
          updated_at: string | null
        }
        Insert: {
          actions?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          tenant_id?: string
          trigger_conditions?: Json | null
          trigger_type: string
          updated_at?: string | null
        }
        Update: {
          actions?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          tenant_id?: string
          trigger_conditions?: Json | null
          trigger_type?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      building_footprints: {
        Row: {
          building_polygon: Json
          confidence_score: number | null
          created_at: string | null
          geom_geog: unknown
          id: string
          imagery_date: string | null
          last_verified_at: string | null
          lat: number
          lng: number
          roof_segments: Json | null
          source: string
          updated_at: string | null
        }
        Insert: {
          building_polygon: Json
          confidence_score?: number | null
          created_at?: string | null
          geom_geog?: unknown
          id?: string
          imagery_date?: string | null
          last_verified_at?: string | null
          lat: number
          lng: number
          roof_segments?: Json | null
          source: string
          updated_at?: string | null
        }
        Update: {
          building_polygon?: Json
          confidence_score?: number | null
          created_at?: string | null
          geom_geog?: unknown
          id?: string
          imagery_date?: string | null
          last_verified_at?: string | null
          lat?: number
          lng?: number
          roof_segments?: Json | null
          source?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      button_audit_results: {
        Row: {
          button_name: string | null
          button_type: string | null
          created_at: string
          file_path: string
          has_error_handling: boolean
          has_onclick: boolean
          id: string
          issues: Json | null
          last_audited_at: string
          pathway_validated: boolean
          recommendations: Json | null
          tenant_id: string
        }
        Insert: {
          button_name?: string | null
          button_type?: string | null
          created_at?: string
          file_path: string
          has_error_handling?: boolean
          has_onclick?: boolean
          id?: string
          issues?: Json | null
          last_audited_at?: string
          pathway_validated?: boolean
          recommendations?: Json | null
          tenant_id: string
        }
        Update: {
          button_name?: string | null
          button_type?: string | null
          created_at?: string
          file_path?: string
          has_error_handling?: boolean
          has_onclick?: boolean
          id?: string
          issues?: Json | null
          last_audited_at?: string
          pathway_validated?: boolean
          recommendations?: Json | null
          tenant_id?: string
        }
        Relationships: []
      }
      calendar_sync_events: {
        Row: {
          created_at: string
          google_calendar_event_id: string | null
          id: string
          last_synced_at: string | null
          sync_error: string | null
          sync_status: string
          task_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          google_calendar_event_id?: string | null
          id?: string
          last_synced_at?: string | null
          sync_error?: string | null
          sync_status?: string
          task_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          google_calendar_event_id?: string | null
          id?: string
          last_synced_at?: string | null
          sync_error?: string | null
          sync_status?: string
          task_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      call_dispositions: {
        Row: {
          call_id: string | null
          call_sid: string | null
          created_at: string
          created_by: string | null
          disposition: string
          id: string
          notes: string | null
          tenant_id: string
        }
        Insert: {
          call_id?: string | null
          call_sid?: string | null
          created_at?: string
          created_by?: string | null
          disposition: string
          id?: string
          notes?: string | null
          tenant_id: string
        }
        Update: {
          call_id?: string | null
          call_sid?: string | null
          created_at?: string
          created_by?: string | null
          disposition?: string
          id?: string
          notes?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_dispositions_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "call_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      call_events: {
        Row: {
          call_id: string | null
          campaign_id: string | null
          client_state: Json | null
          created_at: string | null
          event_data: Json | null
          event_type: string
          id: string
          telnyx_call_control_id: string | null
          tenant_id: string
        }
        Insert: {
          call_id?: string | null
          campaign_id?: string | null
          client_state?: Json | null
          created_at?: string | null
          event_data?: Json | null
          event_type: string
          id?: string
          telnyx_call_control_id?: string | null
          tenant_id: string
        }
        Update: {
          call_id?: string | null
          campaign_id?: string | null
          client_state?: Json | null
          created_at?: string | null
          event_data?: Json | null
          event_type?: string
          id?: string
          telnyx_call_control_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_events_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "dialer_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      call_forwarding_log: {
        Row: {
          forwarded_number: string
          from_number: string
          id: string
          original_number: string
          status: string
          tenant_id: string
          timestamp: string | null
        }
        Insert: {
          forwarded_number: string
          from_number: string
          id?: string
          original_number: string
          status: string
          tenant_id: string
          timestamp?: string | null
        }
        Update: {
          forwarded_number?: string
          from_number?: string
          id?: string
          original_number?: string
          status?: string
          tenant_id?: string
          timestamp?: string | null
        }
        Relationships: []
      }
      call_forwarding_rules: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean
          rules: Json
          tenant_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean
          rules?: Json
          tenant_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean
          rules?: Json
          tenant_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      call_logs: {
        Row: {
          answered_at: string | null
          asterisk_channel_id: string | null
          asterisk_recording_id: string | null
          bridge_duration_seconds: number | null
          call_sid: string | null
          callee_number: string
          caller_id: string
          contact_id: string | null
          created_at: string | null
          created_by: string | null
          direction: string
          disposition: string | null
          disposition_notes: string | null
          duration_seconds: number | null
          ended_at: string | null
          id: string
          metadata: Json | null
          pipeline_entry_id: string | null
          recording_url: string | null
          started_at: string | null
          status: string
          tenant_id: string
          transcription: string | null
          updated_at: string | null
        }
        Insert: {
          answered_at?: string | null
          asterisk_channel_id?: string | null
          asterisk_recording_id?: string | null
          bridge_duration_seconds?: number | null
          call_sid?: string | null
          callee_number: string
          caller_id: string
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          direction: string
          disposition?: string | null
          disposition_notes?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          metadata?: Json | null
          pipeline_entry_id?: string | null
          recording_url?: string | null
          started_at?: string | null
          status?: string
          tenant_id: string
          transcription?: string | null
          updated_at?: string | null
        }
        Update: {
          answered_at?: string | null
          asterisk_channel_id?: string | null
          asterisk_recording_id?: string | null
          bridge_duration_seconds?: number | null
          call_sid?: string | null
          callee_number?: string
          caller_id?: string
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          direction?: string
          disposition?: string | null
          disposition_notes?: string | null
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          metadata?: Json | null
          pipeline_entry_id?: string | null
          recording_url?: string | null
          started_at?: string | null
          status?: string
          tenant_id?: string
          transcription?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      call_transcripts: {
        Row: {
          call_id: string
          confidence: number | null
          created_at: string | null
          id: string
          is_partial: boolean | null
          speaker: string | null
          tenant_id: string
          timestamp_ms: number
          transcript_text: string
        }
        Insert: {
          call_id: string
          confidence?: number | null
          created_at?: string | null
          id?: string
          is_partial?: boolean | null
          speaker?: string | null
          tenant_id: string
          timestamp_ms: number
          transcript_text: string
        }
        Update: {
          call_id?: string
          confidence?: number | null
          created_at?: string | null
          id?: string
          is_partial?: boolean | null
          speaker?: string | null
          tenant_id?: string
          timestamp_ms?: number
          transcript_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_transcripts_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "calls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_transcripts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      calls: {
        Row: {
          answered_at: string | null
          campaign_id: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          direction: string | null
          duration: number | null
          duration_seconds: number | null
          ended_at: string | null
          from_number: string | null
          handled_by: string | null
          id: string
          notes: string | null
          recording_url: string | null
          status: string | null
          telnyx_call_control_id: string | null
          tenant_id: string
          to_number: string | null
          updated_at: string
        }
        Insert: {
          answered_at?: string | null
          campaign_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string | null
          duration?: number | null
          duration_seconds?: number | null
          ended_at?: string | null
          from_number?: string | null
          handled_by?: string | null
          id?: string
          notes?: string | null
          recording_url?: string | null
          status?: string | null
          telnyx_call_control_id?: string | null
          tenant_id: string
          to_number?: string | null
          updated_at?: string
        }
        Update: {
          answered_at?: string | null
          campaign_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: string | null
          duration?: number | null
          duration_seconds?: number | null
          ended_at?: string | null
          from_number?: string | null
          handled_by?: string | null
          id?: string
          notes?: string | null
          recording_url?: string | null
          status?: string | null
          telnyx_call_control_id?: string | null
          tenant_id?: string
          to_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calls_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "dialer_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calls_handled_by_fkey"
            columns: ["handled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      canvass_achievements: {
        Row: {
          achievement_type: Database["public"]["Enums"]["achievement_type"]
          category: string
          created_at: string
          created_by: string | null
          criteria: Json
          description: string | null
          icon_url: string | null
          id: string
          is_active: boolean
          name: string
          reward_metadata: Json | null
          reward_points: number
          reward_type: Database["public"]["Enums"]["reward_type"] | null
          reward_value: number | null
          tenant_id: string
          tier: Database["public"]["Enums"]["achievement_tier"]
          updated_at: string
        }
        Insert: {
          achievement_type?: Database["public"]["Enums"]["achievement_type"]
          category: string
          created_at?: string
          created_by?: string | null
          criteria?: Json
          description?: string | null
          icon_url?: string | null
          id?: string
          is_active?: boolean
          name: string
          reward_metadata?: Json | null
          reward_points?: number
          reward_type?: Database["public"]["Enums"]["reward_type"] | null
          reward_value?: number | null
          tenant_id: string
          tier?: Database["public"]["Enums"]["achievement_tier"]
          updated_at?: string
        }
        Update: {
          achievement_type?: Database["public"]["Enums"]["achievement_type"]
          category?: string
          created_at?: string
          created_by?: string | null
          criteria?: Json
          description?: string | null
          icon_url?: string | null
          id?: string
          is_active?: boolean
          name?: string
          reward_metadata?: Json | null
          reward_points?: number
          reward_type?: Database["public"]["Enums"]["reward_type"] | null
          reward_value?: number | null
          tenant_id?: string
          tier?: Database["public"]["Enums"]["achievement_tier"]
          updated_at?: string
        }
        Relationships: []
      }
      canvass_activity_log: {
        Row: {
          activity_data: Json
          activity_type: string
          contact_id: string | null
          created_at: string
          id: string
          latitude: number | null
          location_id: string | null
          longitude: number | null
          quality_score: number | null
          tenant_id: string
          user_id: string
          verified: boolean
        }
        Insert: {
          activity_data?: Json
          activity_type: string
          contact_id?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          location_id?: string | null
          longitude?: number | null
          quality_score?: number | null
          tenant_id: string
          user_id: string
          verified?: boolean
        }
        Update: {
          activity_data?: Json
          activity_type?: string
          contact_id?: string | null
          created_at?: string
          id?: string
          latitude?: number | null
          location_id?: string | null
          longitude?: number | null
          quality_score?: number | null
          tenant_id?: string
          user_id?: string
          verified?: boolean
        }
        Relationships: []
      }
      canvass_competitions: {
        Row: {
          auto_enroll: boolean
          competition_type: Database["public"]["Enums"]["competition_type"]
          created_at: string
          created_by: string | null
          description: string | null
          end_date: string
          id: string
          location_filter: string[] | null
          name: string
          prize_pool: Json
          rules: Json
          scoring_criteria: Json
          start_date: string
          status: Database["public"]["Enums"]["competition_status"]
          team_based: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          auto_enroll?: boolean
          competition_type?: Database["public"]["Enums"]["competition_type"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date: string
          id?: string
          location_filter?: string[] | null
          name: string
          prize_pool?: Json
          rules?: Json
          scoring_criteria?: Json
          start_date: string
          status?: Database["public"]["Enums"]["competition_status"]
          team_based?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          auto_enroll?: boolean
          competition_type?: Database["public"]["Enums"]["competition_type"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          end_date?: string
          id?: string
          location_filter?: string[] | null
          name?: string
          prize_pool?: Json
          rules?: Json
          scoring_criteria?: Json
          start_date?: string
          status?: Database["public"]["Enums"]["competition_status"]
          team_based?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      canvass_sessions: {
        Row: {
          created_at: string | null
          expires_at: string
          id: string
          ip_address: unknown
          last_used_at: string | null
          tenant_id: string
          token: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expires_at: string
          id?: string
          ip_address?: unknown
          last_used_at?: string | null
          tenant_id: string
          token: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          expires_at?: string
          id?: string
          ip_address?: unknown
          last_used_at?: string | null
          tenant_id?: string
          token?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      change_order_line_items: {
        Row: {
          change_order_id: string
          created_at: string | null
          description: string | null
          id: string
          item_type: string | null
          quantity: number | null
          total_price: number | null
          unit_price: number | null
        }
        Insert: {
          change_order_id: string
          created_at?: string | null
          description?: string | null
          id?: string
          item_type?: string | null
          quantity?: number | null
          total_price?: number | null
          unit_price?: number | null
        }
        Update: {
          change_order_id?: string
          created_at?: string | null
          description?: string | null
          id?: string
          item_type?: string | null
          quantity?: number | null
          total_price?: number | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "change_order_line_items_change_order_id_fkey"
            columns: ["change_order_id"]
            isOneToOne: false
            referencedRelation: "change_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      change_orders: {
        Row: {
          approved_by: string | null
          approved_date: string | null
          co_number: string
          completed_date: string | null
          cost_impact: number | null
          created_at: string | null
          customer_approved: boolean | null
          customer_approved_at: string | null
          description: string | null
          id: string
          new_scope: string | null
          original_scope: string | null
          project_id: string
          reason: string | null
          rejection_reason: string | null
          requested_by: string | null
          requested_date: string | null
          status: string | null
          tenant_id: string
          time_impact_days: number | null
          title: string
          updated_at: string | null
        }
        Insert: {
          approved_by?: string | null
          approved_date?: string | null
          co_number: string
          completed_date?: string | null
          cost_impact?: number | null
          created_at?: string | null
          customer_approved?: boolean | null
          customer_approved_at?: string | null
          description?: string | null
          id?: string
          new_scope?: string | null
          original_scope?: string | null
          project_id: string
          reason?: string | null
          rejection_reason?: string | null
          requested_by?: string | null
          requested_date?: string | null
          status?: string | null
          tenant_id?: string
          time_impact_days?: number | null
          title: string
          updated_at?: string | null
        }
        Update: {
          approved_by?: string | null
          approved_date?: string | null
          co_number?: string
          completed_date?: string | null
          cost_impact?: number | null
          created_at?: string | null
          customer_approved?: boolean | null
          customer_approved_at?: string | null
          description?: string | null
          id?: string
          new_scope?: string | null
          original_scope?: string | null
          project_id?: string
          reason?: string | null
          rejection_reason?: string | null
          requested_by?: string | null
          requested_date?: string | null
          status?: string | null
          tenant_id?: string
          time_impact_days?: number | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "change_orders_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_orders_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "change_orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_calculations: {
        Row: {
          approved_at: string | null
          calculated_at: string | null
          calculation_details: Json | null
          commission_amount: number
          commission_plan_id: string | null
          commission_rate: number
          contract_value: number
          created_by: string | null
          id: string
          paid_at: string | null
          payment_method: string
          project_id: string
          rep_overhead: number
          sales_rep_id: string
          status: string | null
          tenant_id: string
          total_costs: number
        }
        Insert: {
          approved_at?: string | null
          calculated_at?: string | null
          calculation_details?: Json | null
          commission_amount?: number
          commission_plan_id?: string | null
          commission_rate?: number
          contract_value?: number
          created_by?: string | null
          id?: string
          paid_at?: string | null
          payment_method?: string
          project_id: string
          rep_overhead?: number
          sales_rep_id: string
          status?: string | null
          tenant_id: string
          total_costs?: number
        }
        Update: {
          approved_at?: string | null
          calculated_at?: string | null
          calculation_details?: Json | null
          commission_amount?: number
          commission_plan_id?: string | null
          commission_rate?: number
          contract_value?: number
          created_by?: string | null
          id?: string
          paid_at?: string | null
          payment_method?: string
          project_id?: string
          rep_overhead?: number
          sales_rep_id?: string
          status?: string | null
          tenant_id?: string
          total_costs?: number
        }
        Relationships: [
          {
            foreignKeyName: "commission_calculations_commission_plan_id_fkey"
            columns: ["commission_plan_id"]
            isOneToOne: false
            referencedRelation: "commission_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_calculations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_calculations_sales_rep_id_fkey"
            columns: ["sales_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_plans: {
        Row: {
          base_rate: number | null
          commission_type: string
          created_at: string | null
          created_by: string | null
          id: string
          include_overhead: boolean | null
          is_active: boolean | null
          name: string
          overhead_included: boolean | null
          payment_method: string | null
          plan_config: Json
          structure_type:
            | Database["public"]["Enums"]["commission_structure_type"]
            | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          base_rate?: number | null
          commission_type: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          include_overhead?: boolean | null
          is_active?: boolean | null
          name: string
          overhead_included?: boolean | null
          payment_method?: string | null
          plan_config: Json
          structure_type?:
            | Database["public"]["Enums"]["commission_structure_type"]
            | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          base_rate?: number | null
          commission_type?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          include_overhead?: boolean | null
          is_active?: boolean | null
          name?: string
          overhead_included?: boolean | null
          payment_method?: string | null
          plan_config?: Json
          structure_type?:
            | Database["public"]["Enums"]["commission_structure_type"]
            | null
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
      communication_preferences: {
        Row: {
          asterisk_api_token: string | null
          asterisk_api_url: string | null
          created_at: string | null
          email_enabled: boolean | null
          email_from_address: string | null
          recording_announcement: boolean | null
          recording_enabled: boolean | null
          sms_enabled: boolean | null
          sms_from_number: string | null
          tenant_id: string
          updated_at: string | null
          voicemail_email: string | null
          voicemail_enabled: boolean | null
        }
        Insert: {
          asterisk_api_token?: string | null
          asterisk_api_url?: string | null
          created_at?: string | null
          email_enabled?: boolean | null
          email_from_address?: string | null
          recording_announcement?: boolean | null
          recording_enabled?: boolean | null
          sms_enabled?: boolean | null
          sms_from_number?: string | null
          tenant_id: string
          updated_at?: string | null
          voicemail_email?: string | null
          voicemail_enabled?: boolean | null
        }
        Update: {
          asterisk_api_token?: string | null
          asterisk_api_url?: string | null
          created_at?: string | null
          email_enabled?: boolean | null
          email_from_address?: string | null
          recording_announcement?: boolean | null
          recording_enabled?: boolean | null
          sms_enabled?: boolean | null
          sms_from_number?: string | null
          tenant_id?: string
          updated_at?: string | null
          voicemail_email?: string | null
          voicemail_enabled?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_preferences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      company_activity_log: {
        Row: {
          action_description: string
          action_type: string
          created_at: string
          id: string
          ip_address: unknown
          location_info: Json | null
          metadata: Json | null
          resource_id: string | null
          resource_type: string | null
          severity: string
          tenant_id: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action_description: string
          action_type: string
          created_at?: string
          id?: string
          ip_address?: unknown
          location_info?: Json | null
          metadata?: Json | null
          resource_id?: string | null
          resource_type?: string | null
          severity?: string
          tenant_id: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action_description?: string
          action_type?: string
          created_at?: string
          id?: string
          ip_address?: unknown
          location_info?: Json | null
          metadata?: Json | null
          resource_id?: string | null
          resource_type?: string | null
          severity?: string
          tenant_id?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_activity_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_activity_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_leaderboards: {
        Row: {
          competition_id: string
          id: string
          is_final: boolean
          metrics: Json | null
          rank: number
          score: number
          snapshot_at: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          competition_id: string
          id?: string
          is_final?: boolean
          metrics?: Json | null
          rank: number
          score: number
          snapshot_at?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          competition_id?: string
          id?: string
          is_final?: boolean
          metrics?: Json | null
          rank?: number
          score?: number
          snapshot_at?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_leaderboards_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "canvass_competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_participants: {
        Row: {
          competition_id: string
          current_rank: number | null
          current_score: number
          enrolled_at: string
          id: string
          last_activity_at: string | null
          metrics: Json | null
          team_name: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          competition_id: string
          current_rank?: number | null
          current_score?: number
          enrolled_at?: string
          id?: string
          last_activity_at?: string | null
          metrics?: Json | null
          team_name?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          competition_id?: string
          current_rank?: number | null
          current_score?: number
          enrolled_at?: string
          id?: string
          last_activity_at?: string | null
          metrics?: Json | null
          team_name?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_participants_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "canvass_competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_merge_log: {
        Row: {
          id: string
          merged_at: string | null
          merged_by: string | null
          merged_contact_id: string
          merged_data: Json
          primary_contact_id: string
          tenant_id: string
        }
        Insert: {
          id?: string
          merged_at?: string | null
          merged_by?: string | null
          merged_contact_id: string
          merged_data: Json
          primary_contact_id: string
          tenant_id: string
        }
        Update: {
          id?: string
          merged_at?: string | null
          merged_by?: string | null
          merged_contact_id?: string
          merged_data?: Json
          primary_contact_id?: string
          tenant_id?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          acquisition_cost: number | null
          address_city: string | null
          address_state: string | null
          address_street: string | null
          address_verification_data: Json | null
          address_zip: string | null
          assigned_to: string | null
          clj_formatted_number: string | null
          clj_number: string | null
          company_name: string | null
          contact_number: string | null
          created_at: string | null
          created_by: string | null
          created_by_ghost: string | null
          deleted_at: string | null
          deleted_by: string | null
          email: string | null
          email_engagement_score: number | null
          first_name: string | null
          id: string
          is_deleted: boolean | null
          last_name: string | null
          last_nurturing_activity: string | null
          last_scored_at: string | null
          latitude: number | null
          lead_score: number | null
          lead_source: string | null
          lead_source_details: Json | null
          lead_status: string | null
          location_id: string | null
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
          verified_address: Json | null
        }
        Insert: {
          acquisition_cost?: number | null
          address_city?: string | null
          address_state?: string | null
          address_street?: string | null
          address_verification_data?: Json | null
          address_zip?: string | null
          assigned_to?: string | null
          clj_formatted_number?: string | null
          clj_number?: string | null
          company_name?: string | null
          contact_number?: string | null
          created_at?: string | null
          created_by?: string | null
          created_by_ghost?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          email_engagement_score?: number | null
          first_name?: string | null
          id?: string
          is_deleted?: boolean | null
          last_name?: string | null
          last_nurturing_activity?: string | null
          last_scored_at?: string | null
          latitude?: number | null
          lead_score?: number | null
          lead_source?: string | null
          lead_source_details?: Json | null
          lead_status?: string | null
          location_id?: string | null
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
          verified_address?: Json | null
        }
        Update: {
          acquisition_cost?: number | null
          address_city?: string | null
          address_state?: string | null
          address_street?: string | null
          address_verification_data?: Json | null
          address_zip?: string | null
          assigned_to?: string | null
          clj_formatted_number?: string | null
          clj_number?: string | null
          company_name?: string | null
          contact_number?: string | null
          created_at?: string | null
          created_by?: string | null
          created_by_ghost?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          email_engagement_score?: number | null
          first_name?: string | null
          id?: string
          is_deleted?: boolean | null
          last_name?: string | null
          last_nurturing_activity?: string | null
          last_scored_at?: string | null
          latitude?: number | null
          lead_score?: number | null
          lead_source?: string | null
          lead_source_details?: Json | null
          lead_status?: string | null
          location_id?: string | null
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
          verified_address?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_created_by_ghost_fkey"
            columns: ["created_by_ghost"]
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
      crew_availability: {
        Row: {
          available_slots: number
          created_at: string
          crew_id: string
          date: string
          id: string
          notes: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          available_slots?: number
          created_at?: string
          crew_id: string
          date: string
          id?: string
          notes?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          available_slots?: number
          created_at?: string
          crew_id?: string
          date?: string
          id?: string
          notes?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      crews: {
        Row: {
          capacity_slots: number
          color: string | null
          created_at: string
          created_by: string | null
          hourly_rate: number | null
          id: string
          is_active: boolean
          name: string
          skills: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          capacity_slots?: number
          color?: string | null
          created_at?: string
          created_by?: string | null
          hourly_rate?: number | null
          id?: string
          is_active?: boolean
          name: string
          skills?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          capacity_slots?: number
          color?: string | null
          created_at?: string
          created_by?: string | null
          hourly_rate?: number | null
          id?: string
          is_active?: boolean
          name?: string
          skills?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      customer_reviews: {
        Row: {
          clj_number: string | null
          contact_id: string
          created_at: string | null
          id: string
          is_public: boolean | null
          project_id: string | null
          rating: number
          responded_at: string | null
          responded_by: string | null
          response_text: string | null
          review_source: string | null
          review_text: string | null
          reviewed_at: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          clj_number?: string | null
          contact_id: string
          created_at?: string | null
          id?: string
          is_public?: boolean | null
          project_id?: string | null
          rating: number
          responded_at?: string | null
          responded_by?: string | null
          response_text?: string | null
          review_source?: string | null
          review_text?: string | null
          reviewed_at?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          clj_number?: string | null
          contact_id?: string
          created_at?: string | null
          id?: string
          is_public?: boolean | null
          project_id?: string | null
          rating?: number
          responded_at?: string | null
          responded_by?: string | null
          response_text?: string | null
          review_source?: string | null
          review_text?: string | null
          reviewed_at?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_reviews_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_reviews_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_reviews_responded_by_fkey"
            columns: ["responded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_reviews_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      deleted_contacts: {
        Row: {
          access_level: string | null
          contact_data: Json
          deleted_at: string | null
          deleted_by: string | null
          deletion_reason: string | null
          id: string
          original_contact_id: string
          tenant_id: string
        }
        Insert: {
          access_level?: string | null
          contact_data: Json
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          id?: string
          original_contact_id: string
          tenant_id: string
        }
        Update: {
          access_level?: string | null
          contact_data?: Json
          deleted_at?: string | null
          deleted_by?: string | null
          deletion_reason?: string | null
          id?: string
          original_contact_id?: string
          tenant_id?: string
        }
        Relationships: []
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
          avg_talk_time_seconds: number | null
          caller_id: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          list_id: string | null
          max_parallel_calls: number | null
          name: string
          started_at: string | null
          status: string
          tenant_id: string
          total_answered: number | null
          total_attempts: number | null
          total_bridged: number | null
          updated_at: string
        }
        Insert: {
          avg_talk_time_seconds?: number | null
          caller_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          list_id?: string | null
          max_parallel_calls?: number | null
          name: string
          started_at?: string | null
          status?: string
          tenant_id: string
          total_answered?: number | null
          total_attempts?: number | null
          total_bridged?: number | null
          updated_at?: string
        }
        Update: {
          avg_talk_time_seconds?: number | null
          caller_id?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          list_id?: string | null
          max_parallel_calls?: number | null
          name?: string
          started_at?: string | null
          status?: string
          tenant_id?: string
          total_answered?: number | null
          total_attempts?: number | null
          total_bridged?: number | null
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
      did_campaigns: {
        Row: {
          active: boolean | null
          assigned_agents: string[] | null
          campaign_id: string | null
          campaign_name: string | null
          created_at: string | null
          did: string
          greeting_message: string | null
          id: string
          routing_type: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          assigned_agents?: string[] | null
          campaign_id?: string | null
          campaign_name?: string | null
          created_at?: string | null
          did: string
          greeting_message?: string | null
          id?: string
          routing_type?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          assigned_agents?: string[] | null
          campaign_id?: string | null
          campaign_name?: string | null
          created_at?: string | null
          did?: string
          greeting_message?: string | null
          id?: string
          routing_type?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "did_campaigns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      digital_signatures: {
        Row: {
          created_at: string
          envelope_id: string
          field_id: string | null
          id: string
          ip_address: unknown
          is_valid: boolean
          recipient_id: string
          signature_data: string
          signature_hash: string
          signature_metadata: Json | null
          signed_at: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          envelope_id: string
          field_id?: string | null
          id?: string
          ip_address?: unknown
          is_valid?: boolean
          recipient_id: string
          signature_data: string
          signature_hash: string
          signature_metadata?: Json | null
          signed_at?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          envelope_id?: string
          field_id?: string | null
          id?: string
          ip_address?: unknown
          is_valid?: boolean
          recipient_id?: string
          signature_data?: string
          signature_hash?: string
          signature_metadata?: Json | null
          signed_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "digital_signatures_envelope_id_fkey"
            columns: ["envelope_id"]
            isOneToOne: false
            referencedRelation: "signature_envelopes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "digital_signatures_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "signature_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "digital_signatures_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "signature_recipients"
            referencedColumns: ["id"]
          },
        ]
      }
      docgen_fields: {
        Row: {
          agreement_instance_id: string
          created_at: string | null
          field_key: string
          id: string
          tenant_id: string
          updated_at: string | null
          value: string | null
        }
        Insert: {
          agreement_instance_id: string
          created_at?: string | null
          field_key: string
          id?: string
          tenant_id: string
          updated_at?: string | null
          value?: string | null
        }
        Update: {
          agreement_instance_id?: string
          created_at?: string | null
          field_key?: string
          id?: string
          tenant_id?: string
          updated_at?: string | null
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "docgen_fields_agreement_instance_id_fkey"
            columns: ["agreement_instance_id"]
            isOneToOne: false
            referencedRelation: "agreement_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          agreement_instance_id: string | null
          contact_id: string | null
          created_at: string | null
          description: string | null
          document_type: string | null
          docusign_document_id: string | null
          file_path: string
          file_size: number | null
          filename: string
          id: string
          is_signed_pdf: boolean | null
          is_visible_to_homeowner: boolean | null
          mime_type: string | null
          pipeline_entry_id: string | null
          project_id: string | null
          sha256_hash: string | null
          tenant_id: string | null
          updated_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          agreement_instance_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          description?: string | null
          document_type?: string | null
          docusign_document_id?: string | null
          file_path: string
          file_size?: number | null
          filename: string
          id?: string
          is_signed_pdf?: boolean | null
          is_visible_to_homeowner?: boolean | null
          mime_type?: string | null
          pipeline_entry_id?: string | null
          project_id?: string | null
          sha256_hash?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          agreement_instance_id?: string | null
          contact_id?: string | null
          created_at?: string | null
          description?: string | null
          document_type?: string | null
          docusign_document_id?: string | null
          file_path?: string
          file_size?: number | null
          filename?: string
          id?: string
          is_signed_pdf?: boolean | null
          is_visible_to_homeowner?: boolean | null
          mime_type?: string | null
          pipeline_entry_id?: string | null
          project_id?: string | null
          sha256_hash?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_agreement_instance_id_fkey"
            columns: ["agreement_instance_id"]
            isOneToOne: false
            referencedRelation: "agreement_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
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
      docusign_accounts: {
        Row: {
          account_id: string | null
          base_uri: string | null
          brand_id: string | null
          created_at: string | null
          hmac_secret_id: string | null
          id: string
          integration_key: string
          is_active: boolean | null
          is_demo: boolean | null
          rsa_private_key_id: string
          tenant_id: string
          updated_at: string | null
          user_guid: string
        }
        Insert: {
          account_id?: string | null
          base_uri?: string | null
          brand_id?: string | null
          created_at?: string | null
          hmac_secret_id?: string | null
          id?: string
          integration_key: string
          is_active?: boolean | null
          is_demo?: boolean | null
          rsa_private_key_id: string
          tenant_id: string
          updated_at?: string | null
          user_guid: string
        }
        Update: {
          account_id?: string | null
          base_uri?: string | null
          brand_id?: string | null
          created_at?: string | null
          hmac_secret_id?: string | null
          id?: string
          integration_key?: string
          is_active?: boolean | null
          is_demo?: boolean | null
          rsa_private_key_id?: string
          tenant_id?: string
          updated_at?: string | null
          user_guid?: string
        }
        Relationships: []
      }
      docusign_events: {
        Row: {
          agreement_instance_id: string | null
          created_at: string | null
          envelope_id: string | null
          event_type: string
          id: string
          payload_json: Json
          processed_at: string | null
          tenant_id: string
        }
        Insert: {
          agreement_instance_id?: string | null
          created_at?: string | null
          envelope_id?: string | null
          event_type: string
          id?: string
          payload_json: Json
          processed_at?: string | null
          tenant_id: string
        }
        Update: {
          agreement_instance_id?: string | null
          created_at?: string | null
          envelope_id?: string | null
          event_type?: string
          id?: string
          payload_json?: Json
          processed_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "docusign_events_agreement_instance_id_fkey"
            columns: ["agreement_instance_id"]
            isOneToOne: false
            referencedRelation: "agreement_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      duplicate_detection_rules: {
        Row: {
          created_at: string | null
          created_by: string | null
          field_name: string
          id: string
          is_active: boolean | null
          match_type: string
          rule_name: string
          tenant_id: string
          threshold_score: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          field_name: string
          id?: string
          is_active?: boolean | null
          match_type: string
          rule_name: string
          tenant_id: string
          threshold_score?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          field_name?: string
          id?: string
          is_active?: boolean | null
          match_type?: string
          rule_name?: string
          tenant_id?: string
          threshold_score?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      dynamic_pricing_config: {
        Row: {
          backlog_multiplier: number
          base_markup_percent: number
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          max_margin_percent: number
          min_margin_percent: number
          price_anomaly_threshold_percent: number
          season_multipliers: Json
          tenant_id: string
          updated_at: string
          vendor_leadtime_multipliers: Json
          weather_risk_multiplier: number
          zip_conversion_rates: Json
        }
        Insert: {
          backlog_multiplier?: number
          base_markup_percent?: number
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          max_margin_percent?: number
          min_margin_percent?: number
          price_anomaly_threshold_percent?: number
          season_multipliers?: Json
          tenant_id: string
          updated_at?: string
          vendor_leadtime_multipliers?: Json
          weather_risk_multiplier?: number
          zip_conversion_rates?: Json
        }
        Update: {
          backlog_multiplier?: number
          base_markup_percent?: number
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          max_margin_percent?: number
          min_margin_percent?: number
          price_anomaly_threshold_percent?: number
          season_multipliers?: Json
          tenant_id?: string
          updated_at?: string
          vendor_leadtime_multipliers?: Json
          weather_risk_multiplier?: number
          zip_conversion_rates?: Json
        }
        Relationships: []
      }
      dynamic_pricing_rules: {
        Row: {
          adjustment_value: number
          applies_to: string
          category_filter: string[] | null
          conditions: Json
          created_at: string
          created_by: string | null
          effective_date: string
          expiry_date: string | null
          id: string
          is_active: boolean
          max_adjustment_percent: number | null
          price_adjustment_type: string
          rule_name: string
          rule_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          adjustment_value: number
          applies_to?: string
          category_filter?: string[] | null
          conditions?: Json
          created_at?: string
          created_by?: string | null
          effective_date?: string
          expiry_date?: string | null
          id?: string
          is_active?: boolean
          max_adjustment_percent?: number | null
          price_adjustment_type: string
          rule_name: string
          rule_type: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          adjustment_value?: number
          applies_to?: string
          category_filter?: string[] | null
          conditions?: Json
          created_at?: string
          created_by?: string | null
          effective_date?: string
          expiry_date?: string | null
          id?: string
          is_active?: boolean
          max_adjustment_percent?: number | null
          price_adjustment_type?: string
          rule_name?: string
          rule_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      dynamic_tags: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_frequently_used: boolean | null
          json_path: string
          label: string
          sample_value: string | null
          tenant_id: string
          token: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_frequently_used?: boolean | null
          json_path: string
          label: string
          sample_value?: string | null
          tenant_id?: string
          token: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_frequently_used?: boolean | null
          json_path?: string
          label?: string
          sample_value?: string | null
          tenant_id?: string
          token?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      enhanced_estimates: {
        Row: {
          actual_profit_amount: number
          actual_profit_percent: number
          approval_required: boolean
          approved_at: string | null
          approved_by: string | null
          calculation_metadata: Json
          complexity_level: string
          contingency_percent: number
          created_at: string
          created_by: string | null
          customer_address: string
          customer_name: string
          customer_viewed_at: string | null
          estimate_number: string
          expires_at: string | null
          id: string
          internal_notes: string | null
          labor_cost: number
          labor_hours: number
          labor_markup_percent: number
          labor_rate_per_hour: number
          labor_total: number
          line_items: Json
          location_zone: string | null
          material_cost: number
          material_markup_percent: number
          material_total: number
          notes: string | null
          overhead_amount: number
          overhead_percent: number
          permit_costs: number
          pipeline_entry_id: string | null
          price_per_sq_ft: number
          project_id: string | null
          property_details: Json
          roof_area_sq_ft: number
          roof_pitch: string
          sales_rep_commission_amount: number
          sales_rep_commission_percent: number
          sales_rep_id: string | null
          season: string
          selling_price: number
          sent_to_customer_at: string | null
          status: Database["public"]["Enums"]["estimate_status"]
          subtotal: number
          target_profit_amount: number
          target_profit_percent: number
          template_id: string | null
          tenant_id: string
          updated_at: string
          waste_factor_percent: number
        }
        Insert: {
          actual_profit_amount?: number
          actual_profit_percent?: number
          approval_required?: boolean
          approved_at?: string | null
          approved_by?: string | null
          calculation_metadata?: Json
          complexity_level?: string
          contingency_percent?: number
          created_at?: string
          created_by?: string | null
          customer_address: string
          customer_name: string
          customer_viewed_at?: string | null
          estimate_number: string
          expires_at?: string | null
          id?: string
          internal_notes?: string | null
          labor_cost?: number
          labor_hours?: number
          labor_markup_percent?: number
          labor_rate_per_hour?: number
          labor_total?: number
          line_items?: Json
          location_zone?: string | null
          material_cost?: number
          material_markup_percent?: number
          material_total?: number
          notes?: string | null
          overhead_amount?: number
          overhead_percent?: number
          permit_costs?: number
          pipeline_entry_id?: string | null
          price_per_sq_ft?: number
          project_id?: string | null
          property_details?: Json
          roof_area_sq_ft: number
          roof_pitch?: string
          sales_rep_commission_amount?: number
          sales_rep_commission_percent?: number
          sales_rep_id?: string | null
          season?: string
          selling_price?: number
          sent_to_customer_at?: string | null
          status?: Database["public"]["Enums"]["estimate_status"]
          subtotal?: number
          target_profit_amount?: number
          target_profit_percent?: number
          template_id?: string | null
          tenant_id: string
          updated_at?: string
          waste_factor_percent?: number
        }
        Update: {
          actual_profit_amount?: number
          actual_profit_percent?: number
          approval_required?: boolean
          approved_at?: string | null
          approved_by?: string | null
          calculation_metadata?: Json
          complexity_level?: string
          contingency_percent?: number
          created_at?: string
          created_by?: string | null
          customer_address?: string
          customer_name?: string
          customer_viewed_at?: string | null
          estimate_number?: string
          expires_at?: string | null
          id?: string
          internal_notes?: string | null
          labor_cost?: number
          labor_hours?: number
          labor_markup_percent?: number
          labor_rate_per_hour?: number
          labor_total?: number
          line_items?: Json
          location_zone?: string | null
          material_cost?: number
          material_markup_percent?: number
          material_total?: number
          notes?: string | null
          overhead_amount?: number
          overhead_percent?: number
          permit_costs?: number
          pipeline_entry_id?: string | null
          price_per_sq_ft?: number
          project_id?: string | null
          property_details?: Json
          roof_area_sq_ft?: number
          roof_pitch?: string
          sales_rep_commission_amount?: number
          sales_rep_commission_percent?: number
          sales_rep_id?: string | null
          season?: string
          selling_price?: number
          sent_to_customer_at?: string | null
          status?: Database["public"]["Enums"]["estimate_status"]
          subtotal?: number
          target_profit_amount?: number
          target_profit_percent?: number
          template_id?: string | null
          tenant_id?: string
          updated_at?: string
          waste_factor_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "enhanced_estimates_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "estimate_calculation_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment: {
        Row: {
          assigned_to: string | null
          created_at: string | null
          current_value: number | null
          equipment_type: string
          id: string
          last_maintenance_date: string | null
          location: string | null
          name: string
          next_maintenance_date: string | null
          notes: string | null
          purchase_cost: number | null
          purchase_date: string | null
          serial_number: string | null
          status: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string | null
          current_value?: number | null
          equipment_type: string
          id?: string
          last_maintenance_date?: string | null
          location?: string | null
          name: string
          next_maintenance_date?: string | null
          notes?: string | null
          purchase_cost?: number | null
          purchase_date?: string | null
          serial_number?: string | null
          status?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string | null
          current_value?: number | null
          equipment_type?: string
          id?: string
          last_maintenance_date?: string | null
          location?: string | null
          name?: string
          next_maintenance_date?: string | null
          notes?: string | null
          purchase_cost?: number | null
          purchase_date?: string | null
          serial_number?: string | null
          status?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_assignments: {
        Row: {
          assigned_date: string
          condition_at_checkout: string | null
          condition_at_return: string | null
          created_at: string | null
          crew_id: string | null
          equipment_id: string
          id: string
          notes: string | null
          project_id: string | null
          returned_date: string | null
          tenant_id: string
        }
        Insert: {
          assigned_date: string
          condition_at_checkout?: string | null
          condition_at_return?: string | null
          created_at?: string | null
          crew_id?: string | null
          equipment_id: string
          id?: string
          notes?: string | null
          project_id?: string | null
          returned_date?: string | null
          tenant_id?: string
        }
        Update: {
          assigned_date?: string
          condition_at_checkout?: string | null
          condition_at_return?: string | null
          created_at?: string | null
          crew_id?: string | null
          equipment_id?: string
          id?: string
          notes?: string | null
          project_id?: string | null
          returned_date?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_assignments_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_assignments_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_assignments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_maintenance_log: {
        Row: {
          cost: number | null
          created_at: string | null
          description: string | null
          equipment_id: string
          id: string
          maintenance_type: string | null
          next_service_date: string | null
          performed_by: string | null
          performed_date: string
          tenant_id: string
        }
        Insert: {
          cost?: number | null
          created_at?: string | null
          description?: string | null
          equipment_id: string
          id?: string
          maintenance_type?: string | null
          next_service_date?: string | null
          performed_by?: string | null
          performed_date: string
          tenant_id?: string
        }
        Update: {
          cost?: number | null
          created_at?: string | null
          description?: string | null
          equipment_id?: string
          id?: string
          maintenance_type?: string | null
          next_service_date?: string | null
          performed_by?: string | null
          performed_date?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_maintenance_log_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_maintenance_log_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_approvals: {
        Row: {
          approval_notes: string | null
          approved_at: string | null
          approver_id: string | null
          created_at: string
          estimate_id: string
          estimate_version_id: string
          id: string
          rejection_reason: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approval_notes?: string | null
          approved_at?: string | null
          approver_id?: string | null
          created_at?: string
          estimate_id: string
          estimate_version_id: string
          id?: string
          rejection_reason?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approval_notes?: string | null
          approved_at?: string | null
          approver_id?: string | null
          created_at?: string
          estimate_id?: string
          estimate_version_id?: string
          id?: string
          rejection_reason?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      estimate_bindings: {
        Row: {
          bound_at: string
          bound_by: string | null
          estimate_id: string
          template_id: string
          tenant_id: string
        }
        Insert: {
          bound_at?: string
          bound_by?: string | null
          estimate_id: string
          template_id: string
          tenant_id: string
        }
        Update: {
          bound_at?: string
          bound_by?: string | null
          estimate_id?: string
          template_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_bindings_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: true
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_bindings_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_calculation_templates: {
        Row: {
          base_labor_hours_per_sq: number
          base_labor_rate_per_hour: number
          base_material_cost_per_sq: number
          complexity_multipliers: Json
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          labor_breakdown: Json
          location_multipliers: Json
          material_specifications: Json
          name: string
          overhead_percentage: number
          roof_type: Database["public"]["Enums"]["roof_type"]
          seasonal_multipliers: Json
          target_profit_percentage: number
          template_category: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          base_labor_hours_per_sq?: number
          base_labor_rate_per_hour?: number
          base_material_cost_per_sq?: number
          complexity_multipliers?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          labor_breakdown?: Json
          location_multipliers?: Json
          material_specifications?: Json
          name: string
          overhead_percentage?: number
          roof_type: Database["public"]["Enums"]["roof_type"]
          seasonal_multipliers?: Json
          target_profit_percentage?: number
          template_category?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          base_labor_hours_per_sq?: number
          base_labor_rate_per_hour?: number
          base_material_cost_per_sq?: number
          complexity_multipliers?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          labor_breakdown?: Json
          location_multipliers?: Json
          material_specifications?: Json
          name?: string
          overhead_percentage?: number
          roof_type?: Database["public"]["Enums"]["roof_type"]
          seasonal_multipliers?: Json
          target_profit_percentage?: number
          template_category?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      estimate_commissions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          commission_amount: number
          commission_base_amount: number
          commission_rate: number
          commission_type: string
          created_at: string
          estimate_id: string
          id: string
          payment_date: string | null
          payment_reference: string | null
          payment_status: string
          sales_rep_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          commission_amount?: number
          commission_base_amount: number
          commission_rate?: number
          commission_type?: string
          created_at?: string
          estimate_id: string
          id?: string
          payment_date?: string | null
          payment_reference?: string | null
          payment_status?: string
          sales_rep_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          commission_amount?: number
          commission_base_amount?: number
          commission_rate?: number
          commission_type?: string
          created_at?: string
          estimate_id?: string
          id?: string
          payment_date?: string | null
          payment_reference?: string | null
          payment_status?: string
          sales_rep_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_commissions_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "enhanced_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_cost_items: {
        Row: {
          computed_at: string
          estimate_id: string
          id: string
          item_name: string
          line_total: number
          qty: number
          template_item_id: string | null
          unit_cost: number
        }
        Insert: {
          computed_at?: string
          estimate_id: string
          id?: string
          item_name: string
          line_total?: number
          qty?: number
          template_item_id?: string | null
          unit_cost?: number
        }
        Update: {
          computed_at?: string
          estimate_id?: string
          id?: string
          item_name?: string
          line_total?: number
          qty?: number
          template_item_id?: string | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "estimate_cost_items_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_cost_items_template_item_id_fkey"
            columns: ["template_item_id"]
            isOneToOne: false
            referencedRelation: "template_items"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_costs: {
        Row: {
          computed_at: string
          cost_pre_profit: number
          currency: string
          estimate_id: string
          labor: number
          margin_pct: number | null
          markup_pct: number | null
          materials: number
          mode: string
          overhead: number
          profit: number
          sale_price: number
          tenant_id: string
        }
        Insert: {
          computed_at?: string
          cost_pre_profit?: number
          currency?: string
          estimate_id: string
          labor?: number
          margin_pct?: number | null
          markup_pct?: number | null
          materials?: number
          mode?: string
          overhead?: number
          profit?: number
          sale_price?: number
          tenant_id: string
        }
        Update: {
          computed_at?: string
          cost_pre_profit?: number
          currency?: string
          estimate_id?: string
          labor?: number
          margin_pct?: number | null
          markup_pct?: number | null
          materials?: number
          mode?: string
          overhead?: number
          profit?: number
          sale_price?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_costs_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: true
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_line_items: {
        Row: {
          created_at: string
          description: string | null
          estimate_id: string
          extended_cost: number
          id: string
          is_optional: boolean | null
          item_category: string
          item_name: string
          labor_rate_id: string | null
          line_number: number
          markup_amount: number | null
          markup_percent: number | null
          material_id: string | null
          notes: string | null
          quantity: number
          sort_order: number | null
          srs_item_code: string | null
          tenant_id: string
          total_price: number
          unit_cost: number
          unit_type: string
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          estimate_id: string
          extended_cost?: number
          id?: string
          is_optional?: boolean | null
          item_category: string
          item_name: string
          labor_rate_id?: string | null
          line_number: number
          markup_amount?: number | null
          markup_percent?: number | null
          material_id?: string | null
          notes?: string | null
          quantity?: number
          sort_order?: number | null
          srs_item_code?: string | null
          tenant_id: string
          total_price?: number
          unit_cost?: number
          unit_type?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          estimate_id?: string
          extended_cost?: number
          id?: string
          is_optional?: boolean | null
          item_category?: string
          item_name?: string
          labor_rate_id?: string | null
          line_number?: number
          markup_amount?: number | null
          markup_percent?: number | null
          material_id?: string | null
          notes?: string | null
          quantity?: number
          sort_order?: number | null
          srs_item_code?: string | null
          tenant_id?: string
          total_price?: number
          unit_cost?: number
          unit_type?: string
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estimate_line_items_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "enhanced_estimates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_line_items_labor_rate_id_fkey"
            columns: ["labor_rate_id"]
            isOneToOne: false
            referencedRelation: "labor_rates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_line_items_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "material_costs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estimate_line_items_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_measurements: {
        Row: {
          estimate_id: string
          payload: Json
          squares: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          estimate_id: string
          payload: Json
          squares?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          estimate_id?: string
          payload?: Json
          squares?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "estimate_measurements_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: true
            referencedRelation: "estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      estimate_template_groups: {
        Row: {
          created_at: string | null
          group_type: string
          id: string
          name: string
          sort_order: number
          template_id: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          group_type?: string
          id?: string
          name: string
          sort_order?: number
          template_id: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          group_type?: string
          id?: string
          name?: string
          sort_order?: number
          template_id?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estimate_template_groups_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
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
      estimate_versions: {
        Row: {
          change_reason: string | null
          changes_summary: Json | null
          created_at: string
          created_by: string | null
          estimate_id: string
          id: string
          is_current: boolean
          previous_version_id: string | null
          snapshot_data: Json
          tenant_id: string
          version_number: number
        }
        Insert: {
          change_reason?: string | null
          changes_summary?: Json | null
          created_at?: string
          created_by?: string | null
          estimate_id: string
          id?: string
          is_current?: boolean
          previous_version_id?: string | null
          snapshot_data: Json
          tenant_id: string
          version_number: number
        }
        Update: {
          change_reason?: string | null
          changes_summary?: Json | null
          created_at?: string
          created_by?: string | null
          estimate_id?: string
          id?: string
          is_current?: boolean
          previous_version_id?: string | null
          snapshot_data?: Json
          tenant_id?: string
          version_number?: number
        }
        Relationships: []
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
          measurement_id: string | null
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
          measurement_id?: string | null
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
          measurement_id?: string | null
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
            foreignKeyName: "estimates_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "measurements"
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
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          feature_key: string
          id?: string
          is_enabled?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          feature_key?: string
          id?: string
          is_enabled?: boolean
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
      function_logs: {
        Row: {
          context: Json | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          error_stack: string | null
          execution_id: string | null
          function_name: string
          id: string
          status: string
          tenant_id: string
        }
        Insert: {
          context?: Json | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          error_stack?: string | null
          execution_id?: string | null
          function_name: string
          id?: string
          status: string
          tenant_id: string
        }
        Update: {
          context?: Json | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          error_stack?: string | null
          execution_id?: string | null
          function_name?: string
          id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
      ghost_account_reports: {
        Row: {
          activity_data: Json | null
          activity_type: string
          created_at: string
          ghost_account_id: string
          id: string
          location_data: Json | null
          tenant_id: string
        }
        Insert: {
          activity_data?: Json | null
          activity_type: string
          created_at?: string
          ghost_account_id: string
          id?: string
          location_data?: Json | null
          tenant_id: string
        }
        Update: {
          activity_data?: Json | null
          activity_type?: string
          created_at?: string
          ghost_account_id?: string
          id?: string
          location_data?: Json | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghost_account_reports_ghost_account_id_fkey"
            columns: ["ghost_account_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_connections: {
        Row: {
          access_token_encrypted: string
          calendar_id: string | null
          calendar_name: string | null
          connected_at: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          last_synced_at: string | null
          refresh_token_encrypted: string
          tenant_id: string
          token_expires_at: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token_encrypted: string
          calendar_id?: string | null
          calendar_name?: string | null
          connected_at?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_synced_at?: string | null
          refresh_token_encrypted: string
          tenant_id: string
          token_expires_at: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token_encrypted?: string
          calendar_id?: string | null
          calendar_name?: string | null
          connected_at?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          last_synced_at?: string | null
          refresh_token_encrypted?: string
          tenant_id?: string
          token_expires_at?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
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
      invoice_ar_mirror: {
        Row: {
          balance: number
          created_at: string
          doc_number: string
          id: string
          last_qbo_pull_at: string
          project_id: string
          qbo_invoice_id: string
          qbo_status: string
          tenant_id: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          balance?: number
          created_at?: string
          doc_number: string
          id?: string
          last_qbo_pull_at?: string
          project_id: string
          qbo_invoice_id: string
          qbo_status?: string
          tenant_id: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          balance?: number
          created_at?: string
          doc_number?: string
          id?: string
          last_qbo_pull_at?: string
          project_id?: string
          qbo_invoice_id?: string
          qbo_status?: string
          tenant_id?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_ar_mirror_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      job_budget_versions: {
        Row: {
          created_at: string
          estimate_ref: string | null
          id: string
          job_id: string
          kind: string
          lines: Json
          locked: boolean
          summary: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          estimate_ref?: string | null
          id?: string
          job_id: string
          kind: string
          lines: Json
          locked?: boolean
          summary: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          estimate_ref?: string | null
          id?: string
          job_id?: string
          kind?: string
          lines?: Json
          locked?: boolean
          summary?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      job_cost_events: {
        Row: {
          amount: number
          created_at: string
          doc_url: string | null
          external_ref: string | null
          id: string
          job_id: string
          kind: string
          note: string | null
          occurred_at: string
          tenant_id: string
          vendor_name: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          doc_url?: string | null
          external_ref?: string | null
          id?: string
          job_id: string
          kind: string
          note?: string | null
          occurred_at?: string
          tenant_id: string
          vendor_name?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          doc_url?: string | null
          external_ref?: string | null
          id?: string
          job_id?: string
          kind?: string
          note?: string | null
          occurred_at?: string
          tenant_id?: string
          vendor_name?: string | null
        }
        Relationships: []
      }
      job_type_item_map: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          job_type_code: string
          qbo_class_id: string | null
          qbo_class_name: string | null
          qbo_item_id: string
          qbo_item_name: string | null
          realm_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          job_type_code: string
          qbo_class_id?: string | null
          qbo_class_name?: string | null
          qbo_item_id: string
          qbo_item_name?: string | null
          realm_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          job_type_code?: string
          qbo_class_id?: string | null
          qbo_class_name?: string | null
          qbo_item_id?: string
          qbo_item_name?: string | null
          realm_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          address_street: string | null
          assigned_to: string | null
          contact_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          estimated_value: number | null
          id: string
          is_deleted: boolean | null
          job_number: string | null
          name: string
          pipeline_entry_id: string | null
          priority: string | null
          project_id: string | null
          roof_type: string | null
          status: Database["public"]["Enums"]["job_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address_street?: string | null
          assigned_to?: string | null
          contact_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          estimated_value?: number | null
          id?: string
          is_deleted?: boolean | null
          job_number?: string | null
          name: string
          pipeline_entry_id?: string | null
          priority?: string | null
          project_id?: string | null
          roof_type?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address_street?: string | null
          assigned_to?: string | null
          contact_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          estimated_value?: number | null
          id?: string
          is_deleted?: boolean | null
          job_number?: string | null
          name?: string
          pipeline_entry_id?: string | null
          priority?: string | null
          project_id?: string | null
          roof_type?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      labor_cost_tracking: {
        Row: {
          actual_cost: number | null
          actual_hours: number | null
          budgeted_hours: number | null
          budgeted_rate: number | null
          budgeted_total: number | null
          created_at: string | null
          id: string
          last_updated: string | null
          project_id: string
          tenant_id: string
          variance_cost: number | null
          variance_hours: number | null
        }
        Insert: {
          actual_cost?: number | null
          actual_hours?: number | null
          budgeted_hours?: number | null
          budgeted_rate?: number | null
          budgeted_total?: number | null
          created_at?: string | null
          id?: string
          last_updated?: string | null
          project_id: string
          tenant_id?: string
          variance_cost?: number | null
          variance_hours?: number | null
        }
        Update: {
          actual_cost?: number | null
          actual_hours?: number | null
          budgeted_hours?: number | null
          budgeted_rate?: number | null
          budgeted_total?: number | null
          created_at?: string | null
          id?: string
          last_updated?: string | null
          project_id?: string
          tenant_id?: string
          variance_cost?: number | null
          variance_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "labor_cost_tracking_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "labor_cost_tracking_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      labor_rates: {
        Row: {
          base_rate_per_hour: number
          complexity_multiplier: number | null
          created_at: string
          effective_date: string
          expires_date: string | null
          id: string
          is_active: boolean
          job_type: string
          location_zone: string | null
          seasonal_adjustment: number | null
          skill_level: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          base_rate_per_hour: number
          complexity_multiplier?: number | null
          created_at?: string
          effective_date?: string
          expires_date?: string | null
          id?: string
          is_active?: boolean
          job_type: string
          location_zone?: string | null
          seasonal_adjustment?: number | null
          skill_level?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          base_rate_per_hour?: number
          complexity_multiplier?: number | null
          created_at?: string
          effective_date?: string
          expires_date?: string | null
          id?: string
          is_active?: boolean
          job_type?: string
          location_zone?: string | null
          seasonal_adjustment?: number | null
          skill_level?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
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
          created_at: string
          created_by: string | null
          field_name: string
          field_value: string | null
          id: string
          is_active: boolean | null
          operator: string | null
          points: number
          rule_name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          field_name: string
          field_value?: string | null
          id?: string
          is_active?: boolean | null
          operator?: string | null
          points?: number
          rule_name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          field_name?: string
          field_value?: string | null
          id?: string
          is_active?: boolean | null
          operator?: string | null
          points?: number
          rule_name?: string
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
      locations: {
        Row: {
          address_city: string | null
          address_state: string | null
          address_street: string | null
          address_zip: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          is_active: boolean
          manager_id: string | null
          name: string
          phone: string | null
          qbo_location_ref: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address_city?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          manager_id?: string | null
          name: string
          phone?: string | null
          qbo_location_ref?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address_city?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          manager_id?: string | null
          name?: string
          phone?: string | null
          qbo_location_ref?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      manager_approval_history: {
        Row: {
          action: string
          approval_queue_id: string
          created_at: string
          id: string
          new_status: string | null
          notes: string | null
          performed_by: string | null
          previous_status: string | null
          tenant_id: string
        }
        Insert: {
          action: string
          approval_queue_id: string
          created_at?: string
          id?: string
          new_status?: string | null
          notes?: string | null
          performed_by?: string | null
          previous_status?: string | null
          tenant_id: string
        }
        Update: {
          action?: string
          approval_queue_id?: string
          created_at?: string
          id?: string
          new_status?: string | null
          notes?: string | null
          performed_by?: string | null
          previous_status?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
      manager_approval_queue: {
        Row: {
          approval_type: string | null
          approved_at: string | null
          approved_by: string | null
          business_justification: string | null
          contact_id: string | null
          created_at: string
          estimated_value: number | null
          expires_at: string | null
          id: string
          manager_notes: string | null
          pipeline_entry_id: string
          priority: string
          requested_by: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approval_type?: string | null
          approved_at?: string | null
          approved_by?: string | null
          business_justification?: string | null
          contact_id?: string | null
          created_at?: string
          estimated_value?: number | null
          expires_at?: string | null
          id?: string
          manager_notes?: string | null
          pipeline_entry_id: string
          priority?: string
          requested_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approval_type?: string | null
          approved_at?: string | null
          approved_by?: string | null
          business_justification?: string | null
          contact_id?: string | null
          created_at?: string
          estimated_value?: number | null
          expires_at?: string | null
          id?: string
          manager_notes?: string | null
          pipeline_entry_id?: string
          priority?: string
          requested_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      material_costs: {
        Row: {
          brand: string | null
          cost_per_unit: number
          created_at: string
          current_market_price: number
          id: string
          is_active: boolean
          lead_time_days: number | null
          location_specific: boolean | null
          location_zones: string[] | null
          material_category: string
          material_name: string
          minimum_order_quantity: number | null
          model: string | null
          price_valid_until: string | null
          supplier_id: string | null
          tenant_id: string
          unit_type: string
          updated_at: string
          waste_factor_percent: number | null
        }
        Insert: {
          brand?: string | null
          cost_per_unit: number
          created_at?: string
          current_market_price: number
          id?: string
          is_active?: boolean
          lead_time_days?: number | null
          location_specific?: boolean | null
          location_zones?: string[] | null
          material_category: string
          material_name: string
          minimum_order_quantity?: number | null
          model?: string | null
          price_valid_until?: string | null
          supplier_id?: string | null
          tenant_id: string
          unit_type?: string
          updated_at?: string
          waste_factor_percent?: number | null
        }
        Update: {
          brand?: string | null
          cost_per_unit?: number
          created_at?: string
          current_market_price?: number
          id?: string
          is_active?: boolean
          lead_time_days?: number | null
          location_specific?: boolean | null
          location_zones?: string[] | null
          material_category?: string
          material_name?: string
          minimum_order_quantity?: number | null
          model?: string | null
          price_valid_until?: string | null
          supplier_id?: string | null
          tenant_id?: string
          unit_type?: string
          updated_at?: string
          waste_factor_percent?: number | null
        }
        Relationships: []
      }
      measure_jobs: {
        Row: {
          created_at: string
          created_by: string | null
          error: string | null
          external_ref: string | null
          id: string
          measurement_id: string | null
          property_id: string
          provider: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          external_ref?: string | null
          id?: string
          measurement_id?: string | null
          property_id: string
          provider: string
          status: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error?: string | null
          external_ref?: string | null
          id?: string
          measurement_id?: string | null
          property_id?: string
          provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "measure_jobs_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "measurements"
            referencedColumns: ["id"]
          },
        ]
      }
      measurement_tags: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          measurement_id: string
          property_id: string
          tags: Json
          version: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          measurement_id: string
          property_id: string
          tags: Json
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          measurement_id?: string
          property_id?: string
          tags?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "measurement_tags_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "measurements"
            referencedColumns: ["id"]
          },
        ]
      }
      measurements: {
        Row: {
          created_at: string
          created_by: string | null
          faces: Json
          geom_geog: unknown
          id: string
          is_active: boolean
          linear_features: Json | null
          mapbox_visualization_url: string | null
          penetrations: Json
          property_id: string
          source: string
          summary: Json
          supersedes: string | null
          updated_at: string
          version: number
          visualization_generated_at: string | null
          visualization_metadata: Json | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          faces?: Json
          geom_geog?: unknown
          id?: string
          is_active?: boolean
          linear_features?: Json | null
          mapbox_visualization_url?: string | null
          penetrations?: Json
          property_id: string
          source: string
          summary: Json
          supersedes?: string | null
          updated_at?: string
          version?: number
          visualization_generated_at?: string | null
          visualization_metadata?: Json | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          faces?: Json
          geom_geog?: unknown
          id?: string
          is_active?: boolean
          linear_features?: Json | null
          mapbox_visualization_url?: string | null
          penetrations?: Json
          property_id?: string
          source?: string
          summary?: Json
          supersedes?: string | null
          updated_at?: string
          version?: number
          visualization_generated_at?: string | null
          visualization_metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "measurements_supersedes_fkey"
            columns: ["supersedes"]
            isOneToOne: false
            referencedRelation: "measurements"
            referencedColumns: ["id"]
          },
        ]
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
      notification_executions: {
        Row: {
          automation_rule_id: string | null
          created_at: string | null
          error_message: string | null
          id: string
          recipient_email: string | null
          recipient_phone: string | null
          recipient_type: string
          rendered_content: string | null
          scheduled_for: string | null
          sent_at: string | null
          status: string | null
          template_id: string | null
          tenant_id: string
          trigger_data: Json | null
          trigger_event: string
        }
        Insert: {
          automation_rule_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          recipient_email?: string | null
          recipient_phone?: string | null
          recipient_type: string
          rendered_content?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string | null
          template_id?: string | null
          tenant_id: string
          trigger_data?: Json | null
          trigger_event: string
        }
        Update: {
          automation_rule_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          recipient_email?: string | null
          recipient_phone?: string | null
          recipient_type?: string
          rendered_content?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string | null
          template_id?: string | null
          tenant_id?: string
          trigger_data?: Json | null
          trigger_event?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_executions_automation_rule_id_fkey"
            columns: ["automation_rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_executions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "notification_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          content: string
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          recipient_type: string
          smart_words: Json | null
          subject: string | null
          template_type: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          recipient_type: string
          smart_words?: Json | null
          subject?: string | null
          template_type: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          recipient_type?: string
          smart_words?: Json | null
          subject?: string | null
          template_type?: string
          tenant_id?: string
          updated_at?: string | null
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
      payout_transactions: {
        Row: {
          amount: number
          completed_at: string | null
          created_at: string | null
          currency: string | null
          failure_reason: string | null
          id: string
          reward_id: string | null
          status: string | null
          stripe_payout_id: string | null
          stripe_transfer_id: string | null
          tenant_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          amount: number
          completed_at?: string | null
          created_at?: string | null
          currency?: string | null
          failure_reason?: string | null
          id?: string
          reward_id?: string | null
          status?: string | null
          stripe_payout_id?: string | null
          stripe_transfer_id?: string | null
          tenant_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          completed_at?: string | null
          created_at?: string | null
          currency?: string | null
          failure_reason?: string | null
          id?: string
          reward_id?: string | null
          status?: string | null
          stripe_payout_id?: string | null
          stripe_transfer_id?: string | null
          tenant_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_transactions_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "achievement_rewards"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_activities: {
        Row: {
          activity_type: string
          assigned_to: string | null
          completed_at: string | null
          contact_id: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          metadata: Json | null
          pipeline_entry_id: string | null
          priority: string | null
          scheduled_at: string | null
          status: string | null
          tenant_id: string
          title: string
          updated_at: string | null
        }
        Insert: {
          activity_type: string
          assigned_to?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          pipeline_entry_id?: string | null
          priority?: string | null
          scheduled_at?: string | null
          status?: string | null
          tenant_id: string
          title: string
          updated_at?: string | null
        }
        Update: {
          activity_type?: string
          assigned_to?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          pipeline_entry_id?: string | null
          priority?: string | null
          scheduled_at?: string | null
          status?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      pipeline_automation_rules: {
        Row: {
          actions: Json | null
          created_at: string | null
          created_by: string | null
          description: string | null
          execution_count: number | null
          id: string
          is_active: boolean | null
          last_executed_at: string | null
          name: string
          tenant_id: string
          trigger_conditions: Json | null
          trigger_event: string
          updated_at: string | null
        }
        Insert: {
          actions?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          execution_count?: number | null
          id?: string
          is_active?: boolean | null
          last_executed_at?: string | null
          name: string
          tenant_id: string
          trigger_conditions?: Json | null
          trigger_event: string
          updated_at?: string | null
        }
        Update: {
          actions?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          execution_count?: number | null
          id?: string
          is_active?: boolean | null
          last_executed_at?: string | null
          name?: string
          tenant_id?: string
          trigger_conditions?: Json | null
          trigger_event?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      pipeline_entries: {
        Row: {
          assigned_to: string | null
          clj_formatted_number: string | null
          contact_id: string | null
          contact_number: number | null
          conversion_probability: number | null
          created_at: string | null
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          disqualification_reason: string | null
          estimated_value: number | null
          expected_close_date: string | null
          id: string
          is_deleted: boolean | null
          last_status_change_reason: string | null
          lead_number: number | null
          lead_quality_score: number | null
          lead_temperature: string | null
          location_id: string | null
          manager_approval_status: string | null
          marketing_campaign: string | null
          metadata: Json | null
          notes: string | null
          priority: string | null
          probability_percent: number | null
          qualification_notes: string | null
          requires_manager_approval: boolean | null
          roof_type: Database["public"]["Enums"]["roof_type"] | null
          source: Database["public"]["Enums"]["lead_source"] | null
          status: string | null
          status_entered_at: string | null
          tenant_id: string | null
          updated_at: string | null
          workflow_metadata: Json | null
        }
        Insert: {
          assigned_to?: string | null
          clj_formatted_number?: string | null
          contact_id?: string | null
          contact_number?: number | null
          conversion_probability?: number | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          disqualification_reason?: string | null
          estimated_value?: number | null
          expected_close_date?: string | null
          id?: string
          is_deleted?: boolean | null
          last_status_change_reason?: string | null
          lead_number?: number | null
          lead_quality_score?: number | null
          lead_temperature?: string | null
          location_id?: string | null
          manager_approval_status?: string | null
          marketing_campaign?: string | null
          metadata?: Json | null
          notes?: string | null
          priority?: string | null
          probability_percent?: number | null
          qualification_notes?: string | null
          requires_manager_approval?: boolean | null
          roof_type?: Database["public"]["Enums"]["roof_type"] | null
          source?: Database["public"]["Enums"]["lead_source"] | null
          status?: string | null
          status_entered_at?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          workflow_metadata?: Json | null
        }
        Update: {
          assigned_to?: string | null
          clj_formatted_number?: string | null
          contact_id?: string | null
          contact_number?: number | null
          conversion_probability?: number | null
          created_at?: string | null
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          disqualification_reason?: string | null
          estimated_value?: number | null
          expected_close_date?: string | null
          id?: string
          is_deleted?: boolean | null
          last_status_change_reason?: string | null
          lead_number?: number | null
          lead_quality_score?: number | null
          lead_temperature?: string | null
          location_id?: string | null
          manager_approval_status?: string | null
          marketing_campaign?: string | null
          metadata?: Json | null
          notes?: string | null
          priority?: string | null
          probability_percent?: number | null
          qualification_notes?: string | null
          requires_manager_approval?: boolean | null
          roof_type?: Database["public"]["Enums"]["roof_type"] | null
          source?: Database["public"]["Enums"]["lead_source"] | null
          status?: string | null
          status_entered_at?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          workflow_metadata?: Json | null
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
      pipeline_stages: {
        Row: {
          auto_actions: Json | null
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          probability_percent: number
          stage_order: number
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          auto_actions?: Json | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          probability_percent?: number
          stage_order?: number
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          auto_actions?: Json | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          probability_percent?: number
          stage_order?: number
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: []
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
      potential_duplicates: {
        Row: {
          contact_id_1: string
          contact_id_2: string
          created_at: string | null
          id: string
          match_fields: Json | null
          reviewed_at: string | null
          reviewed_by: string | null
          similarity_score: number
          status: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          contact_id_1: string
          contact_id_2: string
          created_at?: string | null
          id?: string
          match_fields?: Json | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          similarity_score: number
          status?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          contact_id_1?: string
          contact_id_2?: string
          created_at?: string | null
          id?: string
          match_fields?: Json | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          similarity_score?: number
          status?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      presentation_sessions: {
        Row: {
          completed_at: string | null
          contact_id: string | null
          created_at: string
          current_slide_index: number | null
          id: string
          presentation_id: string
          signature_captured: boolean | null
          signature_data: Json | null
          started_at: string
          status: string
          tenant_id: string
          updated_at: string
          viewer_metadata: Json | null
        }
        Insert: {
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          current_slide_index?: number | null
          id?: string
          presentation_id: string
          signature_captured?: boolean | null
          signature_data?: Json | null
          started_at?: string
          status?: string
          tenant_id: string
          updated_at?: string
          viewer_metadata?: Json | null
        }
        Update: {
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          current_slide_index?: number | null
          id?: string
          presentation_id?: string
          signature_captured?: boolean | null
          signature_data?: Json | null
          started_at?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          viewer_metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "presentation_sessions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presentation_sessions_presentation_id_fkey"
            columns: ["presentation_id"]
            isOneToOne: false
            referencedRelation: "presentations"
            referencedColumns: ["id"]
          },
        ]
      }
      presentation_slides: {
        Row: {
          content: Json
          created_at: string
          id: string
          notes: string | null
          presentation_id: string
          slide_order: number
          slide_type: string
          transition_effect: string | null
          updated_at: string
        }
        Insert: {
          content?: Json
          created_at?: string
          id?: string
          notes?: string | null
          presentation_id: string
          slide_order: number
          slide_type: string
          transition_effect?: string | null
          updated_at?: string
        }
        Update: {
          content?: Json
          created_at?: string
          id?: string
          notes?: string | null
          presentation_id?: string
          slide_order?: number
          slide_type?: string
          transition_effect?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "presentation_slides_presentation_id_fkey"
            columns: ["presentation_id"]
            isOneToOne: false
            referencedRelation: "presentations"
            referencedColumns: ["id"]
          },
        ]
      }
      presentations: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_template: boolean
          name: string
          template_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_template?: boolean
          name: string
          template_type?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_template?: boolean
          name?: string
          template_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      price_cache: {
        Row: {
          branch_code: string | null
          created_at: string | null
          currency: string | null
          effective_date: string | null
          expires_at: string | null
          id: string
          last_seen_at: string | null
          metadata: Json | null
          price: number
          product_id: string
          quantity_break: number | null
          seen_at: string | null
          source: string | null
          source_data: Json | null
          source_type: string
          supplier_account_id: string | null
          tenant_id: string
          updated_at: string | null
          vendor_id: string
        }
        Insert: {
          branch_code?: string | null
          created_at?: string | null
          currency?: string | null
          effective_date?: string | null
          expires_at?: string | null
          id?: string
          last_seen_at?: string | null
          metadata?: Json | null
          price: number
          product_id: string
          quantity_break?: number | null
          seen_at?: string | null
          source?: string | null
          source_data?: Json | null
          source_type: string
          supplier_account_id?: string | null
          tenant_id: string
          updated_at?: string | null
          vendor_id: string
        }
        Update: {
          branch_code?: string | null
          created_at?: string | null
          currency?: string | null
          effective_date?: string | null
          expires_at?: string | null
          id?: string
          last_seen_at?: string | null
          metadata?: Json | null
          price?: number
          product_id?: string
          quantity_break?: number | null
          seen_at?: string | null
          source?: string | null
          source_data?: Json | null
          source_type?: string
          supplier_account_id?: string | null
          tenant_id?: string
          updated_at?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_cache_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_cache_supplier_account_id_fkey"
            columns: ["supplier_account_id"]
            isOneToOne: false
            referencedRelation: "supplier_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_cache_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      price_history: {
        Row: {
          branch_code: string | null
          changed_at: string
          created_at: string
          id: string
          new_price: number
          old_price: number | null
          price_change_pct: number | null
          product_name: string | null
          sku: string
          sync_log_id: string | null
          tenant_id: string
          vendor_code: string
        }
        Insert: {
          branch_code?: string | null
          changed_at?: string
          created_at?: string
          id?: string
          new_price: number
          old_price?: number | null
          price_change_pct?: number | null
          product_name?: string | null
          sku: string
          sync_log_id?: string | null
          tenant_id: string
          vendor_code: string
        }
        Update: {
          branch_code?: string | null
          changed_at?: string
          created_at?: string
          id?: string
          new_price?: number
          old_price?: number | null
          price_change_pct?: number | null
          product_name?: string | null
          sku?: string
          sync_log_id?: string | null
          tenant_id?: string
          vendor_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_history_sync_log_id_fkey"
            columns: ["sync_log_id"]
            isOneToOne: false
            referencedRelation: "price_sync_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      price_sync_logs: {
        Row: {
          completed_at: string | null
          created_at: string
          errors: Json | null
          failed_updates: number | null
          id: string
          started_at: string
          status: string
          successful_updates: number | null
          sync_type: string
          tenant_id: string
          total_skus: number | null
          triggered_by: string | null
          vendor_code: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          errors?: Json | null
          failed_updates?: number | null
          id?: string
          started_at?: string
          status?: string
          successful_updates?: number | null
          sync_type: string
          tenant_id: string
          total_skus?: number | null
          triggered_by?: string | null
          vendor_code: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          errors?: Json | null
          failed_updates?: number | null
          id?: string
          started_at?: string
          status?: string
          successful_updates?: number | null
          sync_type?: string
          tenant_id?: string
          total_skus?: number | null
          triggered_by?: string | null
          vendor_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_sync_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_sync_logs_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_calculations: {
        Row: {
          backlog_adjustment: number | null
          backlog_days: number | null
          base_cost: number
          base_markup_percent: number
          calculated_at: string
          calculated_by: string | null
          conversion_rate_percent: number | null
          estimate_id: string | null
          final_markup_percent: number
          id: string
          is_locked: boolean
          labor_cost: number
          leadtime_adjustment: number | null
          rationale: Json
          season: string
          season_adjustment: number | null
          suggested_price: number
          tenant_id: string
          vendor_leadtime_days: number | null
          weather_adjustment: number | null
          weather_data: Json | null
          weather_risk_score: number | null
          zip_code: string | null
        }
        Insert: {
          backlog_adjustment?: number | null
          backlog_days?: number | null
          base_cost: number
          base_markup_percent: number
          calculated_at?: string
          calculated_by?: string | null
          conversion_rate_percent?: number | null
          estimate_id?: string | null
          final_markup_percent: number
          id?: string
          is_locked?: boolean
          labor_cost: number
          leadtime_adjustment?: number | null
          rationale?: Json
          season: string
          season_adjustment?: number | null
          suggested_price: number
          tenant_id: string
          vendor_leadtime_days?: number | null
          weather_adjustment?: number | null
          weather_data?: Json | null
          weather_risk_score?: number | null
          zip_code?: string | null
        }
        Update: {
          backlog_adjustment?: number | null
          backlog_days?: number | null
          base_cost?: number
          base_markup_percent?: number
          calculated_at?: string
          calculated_by?: string | null
          conversion_rate_percent?: number | null
          estimate_id?: string | null
          final_markup_percent?: number
          id?: string
          is_locked?: boolean
          labor_cost?: number
          leadtime_adjustment?: number | null
          rationale?: Json
          season?: string
          season_adjustment?: number | null
          suggested_price?: number
          tenant_id?: string
          vendor_leadtime_days?: number | null
          weather_adjustment?: number | null
          weather_data?: Json | null
          weather_risk_score?: number | null
          zip_code?: string | null
        }
        Relationships: []
      }
      product_catalog: {
        Row: {
          brand: string
          category: string
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          metadata: Json | null
          model: string
          price_per_square: number | null
          tenant_id: string
          tier: string
          updated_at: string | null
          warranty_years: number | null
        }
        Insert: {
          brand: string
          category: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          model: string
          price_per_square?: number | null
          tenant_id: string
          tier: string
          updated_at?: string | null
          warranty_years?: number | null
        }
        Update: {
          brand?: string
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          model?: string
          price_per_square?: number | null
          tenant_id?: string
          tier?: string
          updated_at?: string | null
          warranty_years?: number | null
        }
        Relationships: []
      }
      production_stage_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_stage: string | null
          id: string
          metadata: Json | null
          notes: string | null
          production_workflow_id: string
          tenant_id: string
          to_stage: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_stage?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          production_workflow_id: string
          tenant_id: string
          to_stage: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_stage?: string | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          production_workflow_id?: string
          tenant_id?: string
          to_stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_stage_history_production_workflow_id_fkey"
            columns: ["production_workflow_id"]
            isOneToOne: false
            referencedRelation: "production_workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      production_stages: {
        Row: {
          color: string
          created_at: string | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          sort_order: number
          stage_key: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          color?: string
          created_at?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          sort_order: number
          stage_key: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          color?: string
          created_at?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          sort_order?: number
          stage_key?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      production_workflows: {
        Row: {
          created_at: string
          created_by: string | null
          current_stage: string
          documents_uploaded: Json | null
          id: string
          noc_uploaded: boolean
          permit_application_submitted: boolean
          photos: Json | null
          pipeline_entry_id: string | null
          project_id: string
          stage_changed_at: string | null
          stage_data: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          current_stage?: string
          documents_uploaded?: Json | null
          id?: string
          noc_uploaded?: boolean
          permit_application_submitted?: boolean
          photos?: Json | null
          pipeline_entry_id?: string | null
          project_id: string
          stage_changed_at?: string | null
          stage_data?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          current_stage?: string
          documents_uploaded?: Json | null
          id?: string
          noc_uploaded?: boolean
          permit_application_submitted?: boolean
          photos?: Json | null
          pipeline_entry_id?: string | null
          project_id?: string
          stage_changed_at?: string | null
          stage_data?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          category: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          manufacturer: string | null
          name: string
          sku: string
          specifications: Json | null
          srs_item_code: string | null
          tenant_id: string
          unit_of_measure: string | null
          updated_at: string | null
          vendor_id: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          manufacturer?: string | null
          name: string
          sku: string
          specifications?: Json | null
          srs_item_code?: string | null
          tenant_id: string
          unit_of_measure?: string | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          manufacturer?: string | null
          name?: string
          sku?: string
          specifications?: Json | null
          srs_item_code?: string | null
          tenant_id?: string
          unit_of_measure?: string | null
          updated_at?: string | null
          vendor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_tenant_id: string | null
          avatar_url: string | null
          commission_rate: number | null
          commission_structure: string | null
          company_name: string | null
          created_at: string | null
          created_by_master: string | null
          current_location: Json | null
          email: string | null
          first_name: string | null
          id: string
          is_active: boolean | null
          is_developer: boolean | null
          is_ghost_account: boolean | null
          last_name: string | null
          location_updated_at: string | null
          metadata: Json | null
          overhead_rate: number | null
          pay_structure_created_at: string | null
          pay_structure_created_by: string | null
          pay_structure_display: Json | null
          personal_overhead_rate: number | null
          phone: string | null
          photo_url: string | null
          role: Database["public"]["Enums"]["app_role"] | null
          tenant_id: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          active_tenant_id?: string | null
          avatar_url?: string | null
          commission_rate?: number | null
          commission_structure?: string | null
          company_name?: string | null
          created_at?: string | null
          created_by_master?: string | null
          current_location?: Json | null
          email?: string | null
          first_name?: string | null
          id: string
          is_active?: boolean | null
          is_developer?: boolean | null
          is_ghost_account?: boolean | null
          last_name?: string | null
          location_updated_at?: string | null
          metadata?: Json | null
          overhead_rate?: number | null
          pay_structure_created_at?: string | null
          pay_structure_created_by?: string | null
          pay_structure_display?: Json | null
          personal_overhead_rate?: number | null
          phone?: string | null
          photo_url?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
          tenant_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          active_tenant_id?: string | null
          avatar_url?: string | null
          commission_rate?: number | null
          commission_structure?: string | null
          company_name?: string | null
          created_at?: string | null
          created_by_master?: string | null
          current_location?: Json | null
          email?: string | null
          first_name?: string | null
          id?: string
          is_active?: boolean | null
          is_developer?: boolean | null
          is_ghost_account?: boolean | null
          last_name?: string | null
          location_updated_at?: string | null
          metadata?: Json | null
          overhead_rate?: number | null
          pay_structure_created_at?: string | null
          pay_structure_created_by?: string | null
          pay_structure_display?: Json | null
          personal_overhead_rate?: number | null
          phone?: string | null
          photo_url?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
          tenant_id?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_tenant_id_fkey"
            columns: ["active_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_created_by_master_fkey"
            columns: ["created_by_master"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_approval_requests: {
        Row: {
          id: string
          metadata: Json | null
          notes: string | null
          pipeline_entry_id: string
          rejection_reason: string | null
          requested_at: string
          requested_by: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          id?: string
          metadata?: Json | null
          notes?: string | null
          pipeline_entry_id: string
          rejection_reason?: string | null
          requested_at?: string
          requested_by: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          id?: string
          metadata?: Json | null
          notes?: string | null
          pipeline_entry_id?: string
          rejection_reason?: string | null
          requested_at?: string
          requested_by?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_approval_requests_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      project_budget_actuals: {
        Row: {
          actual_labor_cost: number
          actual_material_cost: number
          actual_profit_amount: number
          actual_total: number
          budget_date: string
          budgeted_labor_cost: number
          budgeted_material_cost: number
          budgeted_total: number
          completion_date: string | null
          created_at: string
          estimate_id: string | null
          id: string
          labor_variance: number
          labor_variance_percent: number
          material_variance: number
          material_variance_percent: number
          notes: string | null
          original_profit_amount: number
          profit_variance: number
          project_id: string
          tenant_id: string
          total_variance: number
          total_variance_percent: number
          updated_at: string
        }
        Insert: {
          actual_labor_cost?: number
          actual_material_cost?: number
          actual_profit_amount?: number
          actual_total?: number
          budget_date?: string
          budgeted_labor_cost?: number
          budgeted_material_cost?: number
          budgeted_total?: number
          completion_date?: string | null
          created_at?: string
          estimate_id?: string | null
          id?: string
          labor_variance?: number
          labor_variance_percent?: number
          material_variance?: number
          material_variance_percent?: number
          notes?: string | null
          original_profit_amount?: number
          profit_variance?: number
          project_id: string
          tenant_id: string
          total_variance?: number
          total_variance_percent?: number
          updated_at?: string
        }
        Update: {
          actual_labor_cost?: number
          actual_material_cost?: number
          actual_profit_amount?: number
          actual_total?: number
          budget_date?: string
          budgeted_labor_cost?: number
          budgeted_material_cost?: number
          budgeted_total?: number
          completion_date?: string | null
          created_at?: string
          estimate_id?: string | null
          id?: string
          labor_variance?: number
          labor_variance_percent?: number
          material_variance?: number
          material_variance_percent?: number
          notes?: string | null
          original_profit_amount?: number
          profit_variance?: number
          project_id?: string
          tenant_id?: string
          total_variance?: number
          total_variance_percent?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_budget_actuals_estimate_id_fkey"
            columns: ["estimate_id"]
            isOneToOne: false
            referencedRelation: "enhanced_estimates"
            referencedColumns: ["id"]
          },
        ]
      }
      project_budget_items: {
        Row: {
          actual_quantity: number | null
          actual_total_cost: number | null
          actual_unit_cost: number | null
          budgeted_quantity: number | null
          budgeted_total_cost: number | null
          budgeted_unit_cost: number | null
          category: string
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          item_name: string
          project_id: string
          purchase_order_number: string | null
          tenant_id: string
          updated_at: string | null
          variance_amount: number | null
          variance_percent: number | null
          vendor_name: string | null
        }
        Insert: {
          actual_quantity?: number | null
          actual_total_cost?: number | null
          actual_unit_cost?: number | null
          budgeted_quantity?: number | null
          budgeted_total_cost?: number | null
          budgeted_unit_cost?: number | null
          category: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          item_name: string
          project_id: string
          purchase_order_number?: string | null
          tenant_id: string
          updated_at?: string | null
          variance_amount?: number | null
          variance_percent?: number | null
          vendor_name?: string | null
        }
        Update: {
          actual_quantity?: number | null
          actual_total_cost?: number | null
          actual_unit_cost?: number | null
          budgeted_quantity?: number | null
          budgeted_total_cost?: number | null
          budgeted_unit_cost?: number | null
          category?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          item_name?: string
          project_id?: string
          purchase_order_number?: string | null
          tenant_id?: string
          updated_at?: string | null
          variance_amount?: number | null
          variance_percent?: number | null
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_budget_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
      project_photos: {
        Row: {
          ai_description: string | null
          ai_tags: string[] | null
          capture_timestamp: string | null
          created_at: string
          file_size: number | null
          filename: string
          gps_accuracy: number | null
          gps_latitude: number | null
          gps_longitude: number | null
          id: string
          mime_type: string | null
          project_id: string
          qc_approved_at: string | null
          qc_approved_by: string | null
          qc_notes: string | null
          storage_path: string
          task_id: string | null
          tenant_id: string
          updated_at: string
          uploaded_by: string | null
          workflow_status: string
        }
        Insert: {
          ai_description?: string | null
          ai_tags?: string[] | null
          capture_timestamp?: string | null
          created_at?: string
          file_size?: number | null
          filename: string
          gps_accuracy?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          mime_type?: string | null
          project_id: string
          qc_approved_at?: string | null
          qc_approved_by?: string | null
          qc_notes?: string | null
          storage_path: string
          task_id?: string | null
          tenant_id: string
          updated_at?: string
          uploaded_by?: string | null
          workflow_status?: string
        }
        Update: {
          ai_description?: string | null
          ai_tags?: string[] | null
          capture_timestamp?: string | null
          created_at?: string
          file_size?: number | null
          filename?: string
          gps_accuracy?: number | null
          gps_latitude?: number | null
          gps_longitude?: number | null
          id?: string
          mime_type?: string | null
          project_id?: string
          qc_approved_at?: string | null
          qc_approved_by?: string | null
          qc_notes?: string | null
          storage_path?: string
          task_id?: string | null
          tenant_id?: string
          updated_at?: string
          uploaded_by?: string | null
          workflow_status?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          actual_completion_date: string | null
          budget_data: Json | null
          budget_file_path: string | null
          budget_variance_alerts: boolean | null
          clj_formatted_number: string | null
          contact_number: number | null
          created_at: string | null
          created_by: string | null
          description: string | null
          estimated_completion_date: string | null
          id: string
          job_number: number | null
          lead_number: number | null
          location_id: string | null
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
          budget_data?: Json | null
          budget_file_path?: string | null
          budget_variance_alerts?: boolean | null
          clj_formatted_number?: string | null
          contact_number?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          estimated_completion_date?: string | null
          id?: string
          job_number?: number | null
          lead_number?: number | null
          location_id?: string | null
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
          budget_data?: Json | null
          budget_file_path?: string | null
          budget_variance_alerts?: boolean | null
          clj_formatted_number?: string | null
          contact_number?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          estimated_completion_date?: string | null
          id?: string
          job_number?: number | null
          lead_number?: number | null
          location_id?: string | null
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
            isOneToOne: true
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
      purchase_order_approval_history: {
        Row: {
          action: string
          actor_id: string | null
          approval_id: string | null
          comments: string | null
          created_at: string
          id: string
          metadata: Json | null
          po_id: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          approval_id?: string | null
          comments?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          po_id: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          approval_id?: string | null
          comments?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          po_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_approval_history_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_approval_history_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_approval_rules: {
        Row: {
          approval_type: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          max_amount: number | null
          min_amount: number
          required_approvers: Json
          rule_name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approval_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          max_amount?: number | null
          min_amount?: number
          required_approvers?: Json
          rule_name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approval_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          max_amount?: number | null
          min_amount?: number
          required_approvers?: Json
          rule_name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_order_approvals: {
        Row: {
          approval_level: number
          approver_id: string | null
          comments: string | null
          created_at: string
          id: string
          po_id: string
          requested_at: string
          required_approver_id: string | null
          required_approver_role: string | null
          responded_at: string | null
          rule_id: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approval_level?: number
          approver_id?: string | null
          comments?: string | null
          created_at?: string
          id?: string
          po_id: string
          requested_at?: string
          required_approver_id?: string | null
          required_approver_role?: string | null
          responded_at?: string | null
          rule_id?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approval_level?: number
          approver_id?: string | null
          comments?: string | null
          created_at?: string
          id?: string
          po_id?: string
          requested_at?: string
          required_approver_id?: string | null
          required_approver_role?: string | null
          responded_at?: string | null
          rule_id?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_approvals_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_approvals_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_approval_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          created_at: string | null
          delivered_quantity: number | null
          id: string
          item_description: string | null
          line_total: number
          live_unit_price: number | null
          metadata: Json | null
          po_id: string
          price_age_at_lock_hours: number | null
          price_fetched_from: string | null
          price_locked_at: string | null
          price_variance_pct: number | null
          product_id: string
          quantity: number
          srs_item_code: string | null
          tenant_id: string
          unit_price: number
          vendor_product_id: string | null
        }
        Insert: {
          created_at?: string | null
          delivered_quantity?: number | null
          id?: string
          item_description?: string | null
          line_total: number
          live_unit_price?: number | null
          metadata?: Json | null
          po_id: string
          price_age_at_lock_hours?: number | null
          price_fetched_from?: string | null
          price_locked_at?: string | null
          price_variance_pct?: number | null
          product_id: string
          quantity: number
          srs_item_code?: string | null
          tenant_id: string
          unit_price: number
          vendor_product_id?: string | null
        }
        Update: {
          created_at?: string | null
          delivered_quantity?: number | null
          id?: string
          item_description?: string | null
          line_total?: number
          live_unit_price?: number | null
          metadata?: Json | null
          po_id?: string
          price_age_at_lock_hours?: number | null
          price_fetched_from?: string | null
          price_locked_at?: string | null
          price_variance_pct?: number | null
          product_id?: string
          quantity?: number
          srs_item_code?: string | null
          tenant_id?: string
          unit_price?: number
          vendor_product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_vendor_product_id_fkey"
            columns: ["vendor_product_id"]
            isOneToOne: false
            referencedRelation: "vendor_products"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          actual_delivery_date: string | null
          branch_code: string | null
          created_at: string | null
          created_by: string | null
          delivery_address: Json | null
          expected_delivery_date: string | null
          external_order_id: string | null
          id: string
          notes: string | null
          order_date: string | null
          po_number: string
          project_id: string | null
          shipping_amount: number | null
          status: string | null
          subtotal: number | null
          tax_amount: number | null
          tenant_id: string
          total_amount: number | null
          tracking_number: string | null
          updated_at: string | null
          vendor_id: string
        }
        Insert: {
          actual_delivery_date?: string | null
          branch_code?: string | null
          created_at?: string | null
          created_by?: string | null
          delivery_address?: Json | null
          expected_delivery_date?: string | null
          external_order_id?: string | null
          id?: string
          notes?: string | null
          order_date?: string | null
          po_number: string
          project_id?: string | null
          shipping_amount?: number | null
          status?: string | null
          subtotal?: number | null
          tax_amount?: number | null
          tenant_id: string
          total_amount?: number | null
          tracking_number?: string | null
          updated_at?: string | null
          vendor_id: string
        }
        Update: {
          actual_delivery_date?: string | null
          branch_code?: string | null
          created_at?: string | null
          created_by?: string | null
          delivery_address?: Json | null
          expected_delivery_date?: string | null
          external_order_id?: string | null
          id?: string
          notes?: string | null
          order_date?: string | null
          po_number?: string
          project_id?: string | null
          shipping_amount?: number | null
          status?: string | null
          subtotal?: number | null
          tax_amount?: number | null
          tenant_id?: string
          total_amount?: number | null
          tracking_number?: string | null
          updated_at?: string | null
          vendor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_connections: {
        Row: {
          access_token: string
          connected_at: string
          created_at: string
          expires_at: string
          id: string
          is_active: boolean
          last_synced_at: string | null
          qbo_company_name: string | null
          realm_id: string
          refresh_token: string
          scopes: string[]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          access_token: string
          connected_at?: string
          created_at?: string
          expires_at: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          qbo_company_name?: string | null
          realm_id: string
          refresh_token: string
          scopes?: string[]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          connected_at?: string
          created_at?: string
          expires_at?: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          qbo_company_name?: string | null
          realm_id?: string
          refresh_token?: string
          scopes?: string[]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      qbo_entity_mapping: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json | null
          qbo_entity_id: string
          qbo_entity_type: string
          realm_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          metadata?: Json | null
          qbo_entity_id: string
          qbo_entity_type: string
          realm_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          metadata?: Json | null
          qbo_entity_id?: string
          qbo_entity_type?: string
          realm_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      qbo_location_map: {
        Row: {
          created_at: string
          department_name: string | null
          id: string
          is_active: boolean
          location_id: string
          qbo_department_id: string
          realm_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          department_name?: string | null
          id?: string
          is_active?: boolean
          location_id: string
          qbo_department_id: string
          realm_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          department_name?: string | null
          id?: string
          is_active?: boolean
          location_id?: string
          qbo_department_id?: string
          realm_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      qbo_payment_history: {
        Row: {
          created_at: string | null
          id: string
          metadata: Json | null
          payment_amount: number
          payment_date: string
          payment_method: string | null
          project_id: string | null
          qbo_customer_id: string | null
          qbo_invoice_id: string
          qbo_payment_id: string
          synced_at: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          metadata?: Json | null
          payment_amount?: number
          payment_date: string
          payment_method?: string | null
          project_id?: string | null
          qbo_customer_id?: string | null
          qbo_invoice_id: string
          qbo_payment_id: string
          synced_at?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          metadata?: Json | null
          payment_amount?: number
          payment_date?: string
          payment_method?: string | null
          project_id?: string | null
          qbo_customer_id?: string | null
          qbo_invoice_id?: string
          qbo_payment_id?: string
          synced_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qbo_payment_history_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      qbo_sync_errors: {
        Row: {
          created_at: string | null
          entity_id: string
          entity_type: string
          error_details: Json | null
          error_message: string
          error_type: string
          id: string
          last_retry_at: string | null
          qbo_entity_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          retry_count: number | null
          tenant_id: string
        }
        Insert: {
          created_at?: string | null
          entity_id: string
          entity_type: string
          error_details?: Json | null
          error_message: string
          error_type: string
          id?: string
          last_retry_at?: string | null
          qbo_entity_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          retry_count?: number | null
          tenant_id: string
        }
        Update: {
          created_at?: string | null
          entity_id?: string
          entity_type?: string
          error_details?: Json | null
          error_message?: string
          error_type?: string
          id?: string
          last_retry_at?: string | null
          qbo_entity_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          retry_count?: number | null
          tenant_id?: string
        }
        Relationships: []
      }
      qbo_webhook_journal: {
        Row: {
          created_at: string
          entities: Json
          error_message: string | null
          event_id: string | null
          event_name: string
          event_time: string
          id: string
          processed_at: string | null
          processing_status: string | null
          realm_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          entities?: Json
          error_message?: string | null
          event_id?: string | null
          event_name: string
          event_time: string
          id?: string
          processed_at?: string | null
          processing_status?: string | null
          realm_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          entities?: Json
          error_message?: string | null
          event_id?: string | null
          event_name?: string
          event_time?: string
          id?: string
          processed_at?: string | null
          processing_status?: string | null
          realm_id?: string
          tenant_id?: string
        }
        Relationships: []
      }
      qc_inspections: {
        Row: {
          completed_at: string | null
          created_at: string
          critical_failures: number | null
          id: string
          inspection_data: Json
          inspector_id: string
          overall_score: number | null
          passed_items: number | null
          project_id: string
          report_url: string | null
          status: string
          template_id: string
          tenant_id: string
          total_items: number | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          critical_failures?: number | null
          id?: string
          inspection_data?: Json
          inspector_id: string
          overall_score?: number | null
          passed_items?: number | null
          project_id: string
          report_url?: string | null
          status?: string
          template_id: string
          tenant_id: string
          total_items?: number | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          critical_failures?: number | null
          id?: string
          inspection_data?: Json
          inspector_id?: string
          overall_score?: number | null
          passed_items?: number | null
          project_id?: string
          report_url?: string | null
          status?: string
          template_id?: string
          tenant_id?: string
          total_items?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      qc_templates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean | null
          name: string
          roof_type: string
          template_data: Json
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          roof_type: string
          template_data?: Json
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          roof_type?: string
          template_data?: Json
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          id: string
          request_count: number | null
          resource: string
          user_id: string
          window_start: string | null
        }
        Insert: {
          id?: string
          request_count?: number | null
          resource: string
          user_id: string
          window_start?: string | null
        }
        Update: {
          id?: string
          request_count?: number | null
          resource?: string
          user_id?: string
          window_start?: string | null
        }
        Relationships: []
      }
      recipients: {
        Row: {
          agreement_instance_id: string
          auth_type: string | null
          client_user_id: string | null
          created_at: string | null
          email: string
          id: string
          name: string
          recipient_id: string | null
          role: string
          routing_order: number | null
          signed_at: string | null
          status: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          agreement_instance_id: string
          auth_type?: string | null
          client_user_id?: string | null
          created_at?: string | null
          email: string
          id?: string
          name: string
          recipient_id?: string | null
          role: string
          routing_order?: number | null
          signed_at?: string | null
          status?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          agreement_instance_id?: string
          auth_type?: string | null
          client_user_id?: string | null
          created_at?: string | null
          email?: string
          id?: string
          name?: string
          recipient_id?: string | null
          role?: string
          routing_order?: number | null
          signed_at?: string | null
          status?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recipients_agreement_instance_id_fkey"
            columns: ["agreement_instance_id"]
            isOneToOne: false
            referencedRelation: "agreement_instances"
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
      roof_ai_model_performance: {
        Row: {
          ai_predicted_area_sqft: number | null
          ai_predicted_facet_count: number | null
          ai_predicted_pitch: string | null
          ai_predicted_squares: number | null
          api_calls_made: number | null
          area_accuracy_percent: number | null
          correction_count: number | null
          facet_accuracy_percent: number | null
          final_area_sqft: number | null
          final_facet_count: number | null
          final_pitch: string | null
          final_squares: number | null
          geographic_region: string | null
          id: string
          image_quality_score: number | null
          linear_accuracy_percent: number | null
          logged_at: string | null
          measurement_id: string
          pitch_accuracy: boolean | null
          processing_time_seconds: number | null
          property_type: string | null
          required_manual_corrections: boolean | null
          roof_complexity: string | null
          total_cost_usd: number | null
          user_satisfaction_rating: number | null
        }
        Insert: {
          ai_predicted_area_sqft?: number | null
          ai_predicted_facet_count?: number | null
          ai_predicted_pitch?: string | null
          ai_predicted_squares?: number | null
          api_calls_made?: number | null
          area_accuracy_percent?: number | null
          correction_count?: number | null
          facet_accuracy_percent?: number | null
          final_area_sqft?: number | null
          final_facet_count?: number | null
          final_pitch?: string | null
          final_squares?: number | null
          geographic_region?: string | null
          id?: string
          image_quality_score?: number | null
          linear_accuracy_percent?: number | null
          logged_at?: string | null
          measurement_id: string
          pitch_accuracy?: boolean | null
          processing_time_seconds?: number | null
          property_type?: string | null
          required_manual_corrections?: boolean | null
          roof_complexity?: string | null
          total_cost_usd?: number | null
          user_satisfaction_rating?: number | null
        }
        Update: {
          ai_predicted_area_sqft?: number | null
          ai_predicted_facet_count?: number | null
          ai_predicted_pitch?: string | null
          ai_predicted_squares?: number | null
          api_calls_made?: number | null
          area_accuracy_percent?: number | null
          correction_count?: number | null
          facet_accuracy_percent?: number | null
          final_area_sqft?: number | null
          final_facet_count?: number | null
          final_pitch?: string | null
          final_squares?: number | null
          geographic_region?: string | null
          id?: string
          image_quality_score?: number | null
          linear_accuracy_percent?: number | null
          logged_at?: string | null
          measurement_id?: string
          pitch_accuracy?: boolean | null
          processing_time_seconds?: number | null
          property_type?: string | null
          required_manual_corrections?: boolean | null
          roof_complexity?: string | null
          total_cost_usd?: number | null
          user_satisfaction_rating?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "roof_ai_model_performance_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "roof_measurement_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roof_ai_model_performance_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "roof_measurements"
            referencedColumns: ["id"]
          },
        ]
      }
      roof_facets: {
        Row: {
          area_sqft: number
          azimuth_degrees: number | null
          created_at: string | null
          direction: string | null
          facet_number: number
          geometry_wkt: string | null
          id: string
          is_flat: boolean | null
          measurement_id: string
          perimeter_ft: number | null
          pitch: string
          pitch_degrees: number | null
          pitch_factor: number | null
          plan_area_sqft: number | null
          updated_at: string | null
        }
        Insert: {
          area_sqft: number
          azimuth_degrees?: number | null
          created_at?: string | null
          direction?: string | null
          facet_number: number
          geometry_wkt?: string | null
          id?: string
          is_flat?: boolean | null
          measurement_id: string
          perimeter_ft?: number | null
          pitch: string
          pitch_degrees?: number | null
          pitch_factor?: number | null
          plan_area_sqft?: number | null
          updated_at?: string | null
        }
        Update: {
          area_sqft?: number
          azimuth_degrees?: number | null
          created_at?: string | null
          direction?: string | null
          facet_number?: number
          geometry_wkt?: string | null
          id?: string
          is_flat?: boolean | null
          measurement_id?: string
          perimeter_ft?: number | null
          pitch?: string
          pitch_degrees?: number | null
          pitch_factor?: number | null
          plan_area_sqft?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roof_facets_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "measurements"
            referencedColumns: ["id"]
          },
        ]
      }
      roof_image_cache: {
        Row: {
          access_count: number | null
          address_hash: string
          captured_date: string | null
          created_at: string | null
          expires_at: string | null
          gps_coordinates: Json
          id: string
          image_data: string | null
          image_quality_score: number | null
          image_size: string | null
          image_source: string
          image_url: string | null
          last_accessed_at: string | null
          zoom_level: number | null
        }
        Insert: {
          access_count?: number | null
          address_hash: string
          captured_date?: string | null
          created_at?: string | null
          expires_at?: string | null
          gps_coordinates: Json
          id?: string
          image_data?: string | null
          image_quality_score?: number | null
          image_size?: string | null
          image_source: string
          image_url?: string | null
          last_accessed_at?: string | null
          zoom_level?: number | null
        }
        Update: {
          access_count?: number | null
          address_hash?: string
          captured_date?: string | null
          created_at?: string | null
          expires_at?: string | null
          gps_coordinates?: Json
          id?: string
          image_data?: string | null
          image_quality_score?: number | null
          image_size?: string | null
          image_source?: string
          image_url?: string | null
          last_accessed_at?: string | null
          zoom_level?: number | null
        }
        Relationships: []
      }
      roof_measurement_corrections: {
        Row: {
          corrected_by: string | null
          corrected_value: Json
          correction_method: string | null
          correction_notes: string | null
          correction_reason: string | null
          correction_type: string
          created_at: string | null
          facet_id: string | null
          field_name: string
          id: string
          measurement_id: string
          original_value: Json
          tags: string[] | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          corrected_by?: string | null
          corrected_value: Json
          correction_method?: string | null
          correction_notes?: string | null
          correction_reason?: string | null
          correction_type: string
          created_at?: string | null
          facet_id?: string | null
          field_name: string
          id?: string
          measurement_id: string
          original_value: Json
          tags?: string[] | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          corrected_by?: string | null
          corrected_value?: Json
          correction_method?: string | null
          correction_notes?: string | null
          correction_reason?: string | null
          correction_type?: string
          created_at?: string | null
          facet_id?: string | null
          field_name?: string
          id?: string
          measurement_id?: string
          original_value?: Json
          tags?: string[] | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roof_measurement_corrections_facet_id_fkey"
            columns: ["facet_id"]
            isOneToOne: false
            referencedRelation: "roof_measurement_facets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roof_measurement_corrections_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "roof_measurement_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roof_measurement_corrections_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "roof_measurements"
            referencedColumns: ["id"]
          },
        ]
      }
      roof_measurement_facets: {
        Row: {
          adjacent_facet_ids: string[] | null
          area_adjusted_sqft: number
          area_flat_sqft: number
          azimuth_degrees: number | null
          centroid: Json | null
          chimney_count: number | null
          created_at: string | null
          detection_confidence: number | null
          eave_length: number | null
          facet_number: number
          has_chimney: boolean | null
          has_skylight: boolean | null
          hip_length: number | null
          id: string
          measurement_id: string
          penetration_count: number | null
          pitch: string
          pitch_multiplier: number
          polygon_points: Json
          primary_direction: string | null
          rake_length: number | null
          ridge_length: number | null
          shape_type: string | null
          skylight_count: number | null
          step_flashing_length: number | null
          valley_length: number | null
          vent_count: number | null
          wall_flashing_length: number | null
        }
        Insert: {
          adjacent_facet_ids?: string[] | null
          area_adjusted_sqft: number
          area_flat_sqft: number
          azimuth_degrees?: number | null
          centroid?: Json | null
          chimney_count?: number | null
          created_at?: string | null
          detection_confidence?: number | null
          eave_length?: number | null
          facet_number: number
          has_chimney?: boolean | null
          has_skylight?: boolean | null
          hip_length?: number | null
          id?: string
          measurement_id: string
          penetration_count?: number | null
          pitch: string
          pitch_multiplier: number
          polygon_points: Json
          primary_direction?: string | null
          rake_length?: number | null
          ridge_length?: number | null
          shape_type?: string | null
          skylight_count?: number | null
          step_flashing_length?: number | null
          valley_length?: number | null
          vent_count?: number | null
          wall_flashing_length?: number | null
        }
        Update: {
          adjacent_facet_ids?: string[] | null
          area_adjusted_sqft?: number
          area_flat_sqft?: number
          azimuth_degrees?: number | null
          centroid?: Json | null
          chimney_count?: number | null
          created_at?: string | null
          detection_confidence?: number | null
          eave_length?: number | null
          facet_number?: number
          has_chimney?: boolean | null
          has_skylight?: boolean | null
          hip_length?: number | null
          id?: string
          measurement_id?: string
          penetration_count?: number | null
          pitch?: string
          pitch_multiplier?: number
          polygon_points?: Json
          primary_direction?: string | null
          rake_length?: number | null
          ridge_length?: number | null
          shape_type?: string | null
          skylight_count?: number | null
          step_flashing_length?: number | null
          valley_length?: number | null
          vent_count?: number | null
          wall_flashing_length?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "roof_measurement_facets_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "roof_measurement_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roof_measurement_facets_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "roof_measurements"
            referencedColumns: ["id"]
          },
        ]
      }
      roof_measurement_validation_tests: {
        Row: {
          actual_results: Json | null
          created_at: string | null
          executed_at: string | null
          executed_by: string | null
          expected_results: Json
          failed_metrics: string[] | null
          id: string
          measurement_id: string | null
          overall_accuracy_score: number | null
          passed_metrics: string[] | null
          test_address: string
          test_name: string
          test_notes: string | null
          test_status: string | null
          variance_metrics: Json | null
          warnings: string[] | null
        }
        Insert: {
          actual_results?: Json | null
          created_at?: string | null
          executed_at?: string | null
          executed_by?: string | null
          expected_results: Json
          failed_metrics?: string[] | null
          id?: string
          measurement_id?: string | null
          overall_accuracy_score?: number | null
          passed_metrics?: string[] | null
          test_address: string
          test_name: string
          test_notes?: string | null
          test_status?: string | null
          variance_metrics?: Json | null
          warnings?: string[] | null
        }
        Update: {
          actual_results?: Json | null
          created_at?: string | null
          executed_at?: string | null
          executed_by?: string | null
          expected_results?: Json
          failed_metrics?: string[] | null
          id?: string
          measurement_id?: string | null
          overall_accuracy_score?: number | null
          passed_metrics?: string[] | null
          test_address?: string
          test_name?: string
          test_notes?: string | null
          test_status?: string | null
          variance_metrics?: Json | null
          warnings?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "roof_measurement_validation_tests_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "roof_measurement_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roof_measurement_validation_tests_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "roof_measurements"
            referencedColumns: ["id"]
          },
        ]
      }
      roof_measurements: {
        Row: {
          ai_detection_data: Json
          ai_model_version: string | null
          api_variance_percent: number | null
          complexity_rating: string | null
          created_at: string | null
          customer_id: string | null
          detection_confidence: number | null
          detection_timestamp: string | null
          facet_count: number | null
          google_maps_image_url: string | null
          google_maps_zoom_level: number | null
          gps_coordinates: Json
          id: string
          image_quality_score: number | null
          is_archived: boolean | null
          mapbox_image_url: string | null
          material_calculations: Json | null
          measured_by: string | null
          measurement_confidence: number | null
          notes: string | null
          organization_id: string | null
          pitch_degrees: number | null
          pitch_multiplier: number | null
          pixels_per_foot: number | null
          predominant_pitch: string | null
          property_address: string
          property_city: string | null
          property_state: string | null
          property_zip: string | null
          report_generated_at: string | null
          report_pdf_url: string | null
          requires_manual_review: boolean | null
          roof_type: string | null
          scale_confidence: string | null
          scale_method: string | null
          selected_image_source: string | null
          solar_api_available: boolean | null
          solar_api_response: Json | null
          solar_building_footprint_sqft: number | null
          solar_panel_count: number | null
          tags: string[] | null
          total_area_adjusted_sqft: number | null
          total_area_flat_sqft: number | null
          total_eave_length: number | null
          total_hip_length: number | null
          total_rake_length: number | null
          total_ridge_length: number | null
          total_squares: number | null
          total_squares_with_waste: number | null
          total_step_flashing_length: number | null
          total_unspecified_length: number | null
          total_valley_length: number | null
          total_wall_flashing_length: number | null
          updated_at: string | null
          validation_notes: string | null
          validation_status: string | null
          waste_factor_percent: number | null
        }
        Insert: {
          ai_detection_data: Json
          ai_model_version?: string | null
          api_variance_percent?: number | null
          complexity_rating?: string | null
          created_at?: string | null
          customer_id?: string | null
          detection_confidence?: number | null
          detection_timestamp?: string | null
          facet_count?: number | null
          google_maps_image_url?: string | null
          google_maps_zoom_level?: number | null
          gps_coordinates: Json
          id?: string
          image_quality_score?: number | null
          is_archived?: boolean | null
          mapbox_image_url?: string | null
          material_calculations?: Json | null
          measured_by?: string | null
          measurement_confidence?: number | null
          notes?: string | null
          organization_id?: string | null
          pitch_degrees?: number | null
          pitch_multiplier?: number | null
          pixels_per_foot?: number | null
          predominant_pitch?: string | null
          property_address: string
          property_city?: string | null
          property_state?: string | null
          property_zip?: string | null
          report_generated_at?: string | null
          report_pdf_url?: string | null
          requires_manual_review?: boolean | null
          roof_type?: string | null
          scale_confidence?: string | null
          scale_method?: string | null
          selected_image_source?: string | null
          solar_api_available?: boolean | null
          solar_api_response?: Json | null
          solar_building_footprint_sqft?: number | null
          solar_panel_count?: number | null
          tags?: string[] | null
          total_area_adjusted_sqft?: number | null
          total_area_flat_sqft?: number | null
          total_eave_length?: number | null
          total_hip_length?: number | null
          total_rake_length?: number | null
          total_ridge_length?: number | null
          total_squares?: number | null
          total_squares_with_waste?: number | null
          total_step_flashing_length?: number | null
          total_unspecified_length?: number | null
          total_valley_length?: number | null
          total_wall_flashing_length?: number | null
          updated_at?: string | null
          validation_notes?: string | null
          validation_status?: string | null
          waste_factor_percent?: number | null
        }
        Update: {
          ai_detection_data?: Json
          ai_model_version?: string | null
          api_variance_percent?: number | null
          complexity_rating?: string | null
          created_at?: string | null
          customer_id?: string | null
          detection_confidence?: number | null
          detection_timestamp?: string | null
          facet_count?: number | null
          google_maps_image_url?: string | null
          google_maps_zoom_level?: number | null
          gps_coordinates?: Json
          id?: string
          image_quality_score?: number | null
          is_archived?: boolean | null
          mapbox_image_url?: string | null
          material_calculations?: Json | null
          measured_by?: string | null
          measurement_confidence?: number | null
          notes?: string | null
          organization_id?: string | null
          pitch_degrees?: number | null
          pitch_multiplier?: number | null
          pixels_per_foot?: number | null
          predominant_pitch?: string | null
          property_address?: string
          property_city?: string | null
          property_state?: string | null
          property_zip?: string | null
          report_generated_at?: string | null
          report_pdf_url?: string | null
          requires_manual_review?: boolean | null
          roof_type?: string | null
          scale_confidence?: string | null
          scale_method?: string | null
          selected_image_source?: string | null
          solar_api_available?: boolean | null
          solar_api_response?: Json | null
          solar_building_footprint_sqft?: number | null
          solar_panel_count?: number | null
          tags?: string[] | null
          total_area_adjusted_sqft?: number | null
          total_area_flat_sqft?: number | null
          total_eave_length?: number | null
          total_hip_length?: number | null
          total_rake_length?: number | null
          total_ridge_length?: number | null
          total_squares?: number | null
          total_squares_with_waste?: number | null
          total_step_flashing_length?: number | null
          total_unspecified_length?: number | null
          total_valley_length?: number | null
          total_wall_flashing_length?: number | null
          updated_at?: string | null
          validation_notes?: string | null
          validation_status?: string | null
          waste_factor_percent?: number | null
        }
        Relationships: []
      }
      roof_pitch_multipliers: {
        Row: {
          degrees: number
          multiplier: number
          pitch: string
          rise: number
          run: number | null
          typical_regions: string[] | null
        }
        Insert: {
          degrees: number
          multiplier: number
          pitch: string
          rise: number
          run?: number | null
          typical_regions?: string[] | null
        }
        Update: {
          degrees?: number
          multiplier?: number
          pitch?: string
          rise?: number
          run?: number | null
          typical_regions?: string[] | null
        }
        Relationships: []
      }
      roof_waste_calculations: {
        Row: {
          base_area_sqft: number
          base_squares: number
          created_at: string | null
          id: string
          measurement_id: string
          ridge_cap_bundles: number | null
          shingle_bundles: number | null
          starter_lf: number | null
          total_area_sqft: number
          total_squares: number
          waste_area_sqft: number
          waste_percentage: number
          waste_squares: number
        }
        Insert: {
          base_area_sqft: number
          base_squares: number
          created_at?: string | null
          id?: string
          measurement_id: string
          ridge_cap_bundles?: number | null
          shingle_bundles?: number | null
          starter_lf?: number | null
          total_area_sqft: number
          total_squares: number
          waste_area_sqft: number
          waste_percentage: number
          waste_squares: number
        }
        Update: {
          base_area_sqft?: number
          base_squares?: number
          created_at?: string | null
          id?: string
          measurement_id?: string
          ridge_cap_bundles?: number | null
          shingle_bundles?: number | null
          starter_lf?: number | null
          total_area_sqft?: number
          total_squares?: number
          waste_area_sqft?: number
          waste_percentage?: number
          waste_squares?: number
        }
        Relationships: [
          {
            foreignKeyName: "roof_waste_calculations_measurement_id_fkey"
            columns: ["measurement_id"]
            isOneToOne: false
            referencedRelation: "measurements"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_incidents: {
        Row: {
          corrective_actions: string | null
          created_at: string | null
          description: string
          id: string
          incident_date: string
          incident_type: string
          injuries_reported: boolean | null
          location: string | null
          project_id: string | null
          reported_by: string | null
          severity: string
          status: string | null
          tenant_id: string
          updated_at: string | null
          witnesses: string[] | null
        }
        Insert: {
          corrective_actions?: string | null
          created_at?: string | null
          description: string
          id?: string
          incident_date: string
          incident_type: string
          injuries_reported?: boolean | null
          location?: string | null
          project_id?: string | null
          reported_by?: string | null
          severity: string
          status?: string | null
          tenant_id?: string
          updated_at?: string | null
          witnesses?: string[] | null
        }
        Update: {
          corrective_actions?: string | null
          created_at?: string | null
          description?: string
          id?: string
          incident_date?: string
          incident_type?: string
          injuries_reported?: boolean | null
          location?: string | null
          project_id?: string | null
          reported_by?: string | null
          severity?: string
          status?: string | null
          tenant_id?: string
          updated_at?: string | null
          witnesses?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "safety_incidents_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_inspections: {
        Row: {
          checklist_items: Json | null
          created_at: string | null
          id: string
          inspection_date: string
          inspection_type: string
          inspector_id: string | null
          next_inspection_date: string | null
          notes: string | null
          passed: boolean | null
          project_id: string | null
          tenant_id: string
          updated_at: string | null
          violations: string[] | null
        }
        Insert: {
          checklist_items?: Json | null
          created_at?: string | null
          id?: string
          inspection_date: string
          inspection_type: string
          inspector_id?: string | null
          next_inspection_date?: string | null
          notes?: string | null
          passed?: boolean | null
          project_id?: string | null
          tenant_id?: string
          updated_at?: string | null
          violations?: string[] | null
        }
        Update: {
          checklist_items?: Json | null
          created_at?: string | null
          id?: string
          inspection_date?: string
          inspection_type?: string
          inspector_id?: string | null
          next_inspection_date?: string | null
          notes?: string | null
          passed?: boolean | null
          project_id?: string | null
          tenant_id?: string
          updated_at?: string | null
          violations?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "safety_inspections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_training: {
        Row: {
          certification_number: string | null
          created_at: string | null
          expiration_date: string | null
          id: string
          instructor: string | null
          status: string | null
          tenant_id: string
          training_date: string
          training_type: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          certification_number?: string | null
          created_at?: string | null
          expiration_date?: string | null
          id?: string
          instructor?: string | null
          status?: string | null
          tenant_id?: string
          training_date: string
          training_type: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          certification_number?: string | null
          created_at?: string | null
          expiration_date?: string | null
          id?: string
          instructor?: string | null
          status?: string | null
          tenant_id?: string
          training_date?: string
          training_type?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      satellite_image_cache: {
        Row: {
          access_count: number | null
          cache_key: string
          created_at: string | null
          file_size_bytes: number | null
          height: number
          id: string
          last_accessed_at: string | null
          lat: number
          lng: number
          maptype: string
          storage_path: string
          tenant_id: string | null
          width: number
          zoom: number
        }
        Insert: {
          access_count?: number | null
          cache_key: string
          created_at?: string | null
          file_size_bytes?: number | null
          height: number
          id?: string
          last_accessed_at?: string | null
          lat: number
          lng: number
          maptype: string
          storage_path: string
          tenant_id?: string | null
          width: number
          zoom: number
        }
        Update: {
          access_count?: number | null
          cache_key?: string
          created_at?: string | null
          file_size_bytes?: number | null
          height?: number
          id?: string
          last_accessed_at?: string | null
          lat?: number
          lng?: number
          maptype?: string
          storage_path?: string
          tenant_id?: string | null
          width?: number
          zoom?: number
        }
        Relationships: []
      }
      satisfaction_surveys: {
        Row: {
          clj_number: string | null
          completed_at: string | null
          contact_id: string
          created_at: string | null
          feedback: Json | null
          id: string
          nps_score: number | null
          project_id: string | null
          sent_at: string | null
          sentiment: string | null
          survey_type: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          clj_number?: string | null
          completed_at?: string | null
          contact_id: string
          created_at?: string | null
          feedback?: Json | null
          id?: string
          nps_score?: number | null
          project_id?: string | null
          sent_at?: string | null
          sentiment?: string | null
          survey_type: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          clj_number?: string | null
          completed_at?: string | null
          contact_id?: string
          created_at?: string | null
          feedback?: Json | null
          id?: string
          nps_score?: number | null
          project_id?: string | null
          sent_at?: string | null
          sentiment?: string | null
          survey_type?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "satisfaction_surveys_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "satisfaction_surveys_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "satisfaction_surveys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      session_activity_log: {
        Row: {
          created_at: string
          device_info: string | null
          email: string
          error_message: string | null
          event_type: string
          id: string
          ip_address: string | null
          location_info: string | null
          success: boolean
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          device_info?: string | null
          email: string
          error_message?: string | null
          event_type: string
          id?: string
          ip_address?: string | null
          location_info?: string | null
          success?: boolean
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          device_info?: string | null
          email?: string
          error_message?: string | null
          event_type?: string
          id?: string
          ip_address?: string | null
          location_info?: string | null
          success?: boolean
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      settings_tabs: {
        Row: {
          created_at: string | null
          description: string | null
          icon_name: string
          id: string
          is_active: boolean | null
          label: string
          order_index: number
          required_role: string[] | null
          tab_key: string
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          icon_name?: string
          id?: string
          is_active?: boolean | null
          label: string
          order_index?: number
          required_role?: string[] | null
          tab_key: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          icon_name?: string
          id?: string
          is_active?: boolean | null
          label?: string
          order_index?: number
          required_role?: string[] | null
          tab_key?: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settings_tabs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      signature_envelopes: {
        Row: {
          completed_at: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          envelope_number: string | null
          estimate_id: string | null
          expires_at: string | null
          generated_pdf_path: string | null
          id: string
          pipeline_entry_id: string | null
          project_id: string | null
          sent_at: string | null
          signed_pdf_path: string | null
          status: string
          template_id: string | null
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          envelope_number?: string | null
          estimate_id?: string | null
          expires_at?: string | null
          generated_pdf_path?: string | null
          id?: string
          pipeline_entry_id?: string | null
          project_id?: string | null
          sent_at?: string | null
          signed_pdf_path?: string | null
          status?: string
          template_id?: string | null
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          envelope_number?: string | null
          estimate_id?: string | null
          expires_at?: string | null
          generated_pdf_path?: string | null
          id?: string
          pipeline_entry_id?: string | null
          project_id?: string | null
          sent_at?: string | null
          signed_pdf_path?: string | null
          status?: string
          template_id?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "signature_envelopes_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "signature_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      signature_events: {
        Row: {
          created_at: string
          envelope_id: string
          event_description: string | null
          event_metadata: Json | null
          event_type: string
          id: string
          ip_address: unknown
          recipient_id: string | null
          tenant_id: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          envelope_id: string
          event_description?: string | null
          event_metadata?: Json | null
          event_type: string
          id?: string
          ip_address?: unknown
          recipient_id?: string | null
          tenant_id: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          envelope_id?: string
          event_description?: string | null
          event_metadata?: Json | null
          event_type?: string
          id?: string
          ip_address?: unknown
          recipient_id?: string | null
          tenant_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signature_events_envelope_id_fkey"
            columns: ["envelope_id"]
            isOneToOne: false
            referencedRelation: "signature_envelopes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signature_events_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "signature_recipients"
            referencedColumns: ["id"]
          },
        ]
      }
      signature_fields: {
        Row: {
          created_at: string
          envelope_id: string
          field_key: string
          field_type: string
          field_value: string | null
          height: number | null
          id: string
          is_required: boolean | null
          page_number: number | null
          recipient_id: string | null
          tenant_id: string
          updated_at: string
          width: number | null
          x_position: number | null
          y_position: number | null
        }
        Insert: {
          created_at?: string
          envelope_id: string
          field_key: string
          field_type?: string
          field_value?: string | null
          height?: number | null
          id?: string
          is_required?: boolean | null
          page_number?: number | null
          recipient_id?: string | null
          tenant_id: string
          updated_at?: string
          width?: number | null
          x_position?: number | null
          y_position?: number | null
        }
        Update: {
          created_at?: string
          envelope_id?: string
          field_key?: string
          field_type?: string
          field_value?: string | null
          height?: number | null
          id?: string
          is_required?: boolean | null
          page_number?: number | null
          recipient_id?: string | null
          tenant_id?: string
          updated_at?: string
          width?: number | null
          x_position?: number | null
          y_position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "signature_fields_envelope_id_fkey"
            columns: ["envelope_id"]
            isOneToOne: false
            referencedRelation: "signature_envelopes"
            referencedColumns: ["id"]
          },
        ]
      }
      signature_recipients: {
        Row: {
          access_token: string | null
          created_at: string
          envelope_id: string
          id: string
          ip_address: unknown
          recipient_email: string
          recipient_name: string
          recipient_role: string
          signed_at: string | null
          signing_order: number
          status: string
          tenant_id: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          envelope_id: string
          id?: string
          ip_address?: unknown
          recipient_email: string
          recipient_name: string
          recipient_role?: string
          signed_at?: string | null
          signing_order?: number
          status?: string
          tenant_id: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          access_token?: string | null
          created_at?: string
          envelope_id?: string
          id?: string
          ip_address?: unknown
          recipient_email?: string
          recipient_name?: string
          recipient_role?: string
          signed_at?: string | null
          signing_order?: number
          status?: string
          tenant_id?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signature_recipients_envelope_id_fkey"
            columns: ["envelope_id"]
            isOneToOne: false
            referencedRelation: "signature_envelopes"
            referencedColumns: ["id"]
          },
        ]
      }
      signature_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          liquid_template: string
          name: string
          signature_fields: Json
          template_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          liquid_template: string
          name: string
          signature_fields?: Json
          template_type?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          liquid_template?: string
          name?: string
          signature_fields?: Json
          template_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      skip_trace_results: {
        Row: {
          confidence_score: number | null
          contact_id: string
          cost: number | null
          created_at: string | null
          enriched_data: Json | null
          id: string
          provider: string
          raw_results: Json | null
          requested_by: string | null
          search_parameters: Json | null
          status: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          confidence_score?: number | null
          contact_id: string
          cost?: number | null
          created_at?: string | null
          enriched_data?: Json | null
          id?: string
          provider?: string
          raw_results?: Json | null
          requested_by?: string | null
          search_parameters?: Json | null
          status?: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          confidence_score?: number | null
          contact_id?: string
          cost?: number | null
          created_at?: string | null
          enriched_data?: Json | null
          id?: string
          provider?: string
          raw_results?: Json | null
          requested_by?: string | null
          search_parameters?: Json | null
          status?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "skip_trace_results_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      smart_doc_instances: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          job_id: string | null
          lead_id: string | null
          pdf_url: string | null
          rendered_html: string
          storage_path: string | null
          template_id: string | null
          tenant_id: string
          title: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          job_id?: string | null
          lead_id?: string | null
          pdf_url?: string | null
          rendered_html: string
          storage_path?: string | null
          template_id?: string | null
          tenant_id: string
          title: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          job_id?: string | null
          lead_id?: string | null
          pdf_url?: string | null
          rendered_html?: string
          storage_path?: string | null
          template_id?: string | null
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "smart_doc_instances_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "smart_doc_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      smart_doc_renders: {
        Row: {
          context: Json | null
          id: string
          rendered_at: string | null
          rendered_text: string | null
          resolved_count: number | null
          smart_doc_id: string
          tenant_id: string
          unresolved_tokens: string[] | null
        }
        Insert: {
          context?: Json | null
          id?: string
          rendered_at?: string | null
          rendered_text?: string | null
          resolved_count?: number | null
          smart_doc_id: string
          tenant_id?: string
          unresolved_tokens?: string[] | null
        }
        Update: {
          context?: Json | null
          id?: string
          rendered_at?: string | null
          rendered_text?: string | null
          resolved_count?: number | null
          smart_doc_id?: string
          tenant_id?: string
          unresolved_tokens?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "smart_doc_renders_smart_doc_id_fkey"
            columns: ["smart_doc_id"]
            isOneToOne: false
            referencedRelation: "smart_docs"
            referencedColumns: ["id"]
          },
        ]
      }
      smart_doc_templates: {
        Row: {
          category: string
          content: string
          created_at: string | null
          description: string | null
          id: string
          is_system: boolean | null
          slug: string
          status: string | null
          tenant_id: string
          title: string
          updated_at: string | null
        }
        Insert: {
          category: string
          content: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_system?: boolean | null
          slug: string
          status?: string | null
          tenant_id: string
          title: string
          updated_at?: string | null
        }
        Update: {
          category?: string
          content?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_system?: boolean | null
          slug?: string
          status?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      smart_docs: {
        Row: {
          body: string
          created_at: string | null
          created_by: string | null
          description: string | null
          engine: string | null
          id: string
          name: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          body: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          engine?: string | null
          id?: string
          name: string
          tenant_id?: string
          updated_at?: string | null
        }
        Update: {
          body?: string
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          engine?: string | null
          id?: string
          name?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      smart_word_definitions: {
        Row: {
          category: string | null
          created_at: string | null
          data_field: string
          data_source: string
          description: string | null
          display_name: string
          format_type: string | null
          id: string
          is_system: boolean | null
          tenant_id: string
          word_key: string
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          data_field: string
          data_source: string
          description?: string | null
          display_name: string
          format_type?: string | null
          id?: string
          is_system?: boolean | null
          tenant_id: string
          word_key: string
        }
        Update: {
          category?: string | null
          created_at?: string | null
          data_field?: string
          data_source?: string
          description?: string | null
          display_name?: string
          format_type?: string | null
          id?: string
          is_system?: boolean | null
          tenant_id?: string
          word_key?: string
        }
        Relationships: []
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
      smartwords_rules: {
        Row: {
          action_config: Json
          action_type: string
          created_at: string
          id: string
          is_active: boolean
          keywords: string[]
          name: string
          priority: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          action_config?: Json
          action_type: string
          created_at?: string
          id?: string
          is_active?: boolean
          keywords: string[]
          name: string
          priority?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          action_config?: Json
          action_type?: string
          created_at?: string
          id?: string
          is_active?: boolean
          keywords?: string[]
          name?: string
          priority?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      spatial_ref_sys: {
        Row: {
          auth_name: string | null
          auth_srid: number | null
          proj4text: string | null
          srid: number
          srtext: string | null
        }
        Insert: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid: number
          srtext?: string | null
        }
        Update: {
          auth_name?: string | null
          auth_srid?: number | null
          proj4text?: string | null
          srid?: number
          srtext?: string | null
        }
        Relationships: []
      }
      status_transition_history: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          from_status: string
          id: string
          is_backward: boolean | null
          metadata: Json | null
          pipeline_entry_id: string
          requires_approval: boolean | null
          tenant_id: string
          to_status: string
          transition_reason: string | null
          transitioned_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          from_status: string
          id?: string
          is_backward?: boolean | null
          metadata?: Json | null
          pipeline_entry_id: string
          requires_approval?: boolean | null
          tenant_id: string
          to_status: string
          transition_reason?: string | null
          transitioned_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          from_status?: string
          id?: string
          is_backward?: boolean | null
          metadata?: Json | null
          pipeline_entry_id?: string
          requires_approval?: boolean | null
          tenant_id?: string
          to_status?: string
          transition_reason?: string | null
          transitioned_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "status_transition_history_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_connect_accounts: {
        Row: {
          account_type: string | null
          charges_enabled: boolean | null
          created_at: string | null
          details_submitted: boolean | null
          id: string
          metadata: Json | null
          onboarding_complete: boolean | null
          payouts_enabled: boolean | null
          stripe_account_id: string
          tenant_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_type?: string | null
          charges_enabled?: boolean | null
          created_at?: string | null
          details_submitted?: boolean | null
          id?: string
          metadata?: Json | null
          onboarding_complete?: boolean | null
          payouts_enabled?: boolean | null
          stripe_account_id: string
          tenant_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_type?: string | null
          charges_enabled?: boolean | null
          created_at?: string | null
          details_submitted?: boolean | null
          id?: string
          metadata?: Json | null
          onboarding_complete?: boolean | null
          payouts_enabled?: boolean | null
          stripe_account_id?: string
          tenant_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      subcontractor_capacity: {
        Row: {
          available_slots: number
          booked_slots: number
          created_at: string
          date: string
          id: string
          notes: string | null
          subcontractor_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          available_slots?: number
          booked_slots?: number
          created_at?: string
          date: string
          id?: string
          notes?: string | null
          subcontractor_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          available_slots?: number
          booked_slots?: number
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          subcontractor_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      subcontractor_jobs: {
        Row: {
          actual_end_date: string | null
          actual_start_date: string | null
          cost: number | null
          created_at: string
          created_by: string | null
          feedback: string | null
          id: string
          project_id: string
          rating: number | null
          scheduled_date: string | null
          status: string
          subcontractor_id: string
          task_id: string | null
          tenant_id: string
          trade: string
          updated_at: string
        }
        Insert: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          cost?: number | null
          created_at?: string
          created_by?: string | null
          feedback?: string | null
          id?: string
          project_id: string
          rating?: number | null
          scheduled_date?: string | null
          status?: string
          subcontractor_id: string
          task_id?: string | null
          tenant_id: string
          trade: string
          updated_at?: string
        }
        Update: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          cost?: number | null
          created_at?: string
          created_by?: string | null
          feedback?: string | null
          id?: string
          project_id?: string
          rating?: number | null
          scheduled_date?: string | null
          status?: string
          subcontractor_id?: string
          task_id?: string | null
          tenant_id?: string
          trade?: string
          updated_at?: string
        }
        Relationships: []
      }
      subcontractors: {
        Row: {
          address_city: string | null
          address_state: string | null
          address_street: string | null
          address_zip: string | null
          company_name: string
          contact_name: string | null
          created_at: string
          created_by: string | null
          email: string | null
          id: string
          insurance_expiry_date: string | null
          is_active: boolean | null
          license_expiry_date: string | null
          license_number: string | null
          phone: string | null
          rating: number | null
          tenant_id: string
          trade: string
          updated_at: string
          w9_url: string | null
        }
        Insert: {
          address_city?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          company_name: string
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          insurance_expiry_date?: string | null
          is_active?: boolean | null
          license_expiry_date?: string | null
          license_number?: string | null
          phone?: string | null
          rating?: number | null
          tenant_id: string
          trade: string
          updated_at?: string
          w9_url?: string | null
        }
        Update: {
          address_city?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          company_name?: string
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          id?: string
          insurance_expiry_date?: string | null
          is_active?: boolean | null
          license_expiry_date?: string | null
          license_number?: string | null
          phone?: string | null
          rating?: number | null
          tenant_id?: string
          trade?: string
          updated_at?: string
          w9_url?: string | null
        }
        Relationships: []
      }
      supplier_accounts: {
        Row: {
          api_key_id: string | null
          billtrust_email: string
          billtrust_tenant_id: string | null
          connection_status: string
          created_at: string
          created_by: string | null
          encrypted_credentials: Json | null
          id: string
          is_active: boolean
          last_error: string | null
          last_sync_at: string | null
          supplier_name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          api_key_id?: string | null
          billtrust_email: string
          billtrust_tenant_id?: string | null
          connection_status?: string
          created_at?: string
          created_by?: string | null
          encrypted_credentials?: Json | null
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_sync_at?: string | null
          supplier_name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          api_key_id?: string | null
          billtrust_email?: string
          billtrust_tenant_id?: string | null
          connection_status?: string
          created_at?: string
          created_by?: string | null
          encrypted_credentials?: Json | null
          id?: string
          is_active?: boolean
          last_error?: string | null
          last_sync_at?: string | null
          supplier_name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      supplier_price_sync_logs: {
        Row: {
          completed_at: string | null
          error_details: Json | null
          id: string
          products_added: number | null
          products_processed: number | null
          products_updated: number | null
          started_at: string
          status: string
          supplier_account_id: string
          sync_type: string
          tenant_id: string
        }
        Insert: {
          completed_at?: string | null
          error_details?: Json | null
          id?: string
          products_added?: number | null
          products_processed?: number | null
          products_updated?: number | null
          started_at?: string
          status: string
          supplier_account_id: string
          sync_type: string
          tenant_id: string
        }
        Update: {
          completed_at?: string | null
          error_details?: Json | null
          id?: string
          products_added?: number | null
          products_processed?: number | null
          products_updated?: number | null
          started_at?: string
          status?: string
          supplier_account_id?: string
          sync_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_price_sync_logs_supplier_account_id_fkey"
            columns: ["supplier_account_id"]
            isOneToOne: false
            referencedRelation: "supplier_accounts"
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
      task_dependencies: {
        Row: {
          created_at: string
          dependency_type: string
          depends_on_task_id: string
          id: string
          lag_days: number | null
          task_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          dependency_type?: string
          depends_on_task_id: string
          id?: string
          lag_days?: number | null
          task_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          dependency_type?: string
          depends_on_task_id?: string
          id?: string
          lag_days?: number | null
          task_id?: string
          tenant_id?: string
        }
        Relationships: []
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
      template_items: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          estimate_item_name: string | null
          fixed_price: number | null
          group_id: string | null
          id: string
          item_name: string
          item_type: string | null
          measurement_type: string | null
          pricing_type: string | null
          qty_formula: string
          sort_order: number
          template_id: string
          unit: string
          unit_cost: number
          updated_at: string
          waste_pct: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          estimate_item_name?: string | null
          fixed_price?: number | null
          group_id?: string | null
          id?: string
          item_name: string
          item_type?: string | null
          measurement_type?: string | null
          pricing_type?: string | null
          qty_formula: string
          sort_order?: number
          template_id: string
          unit: string
          unit_cost?: number
          updated_at?: string
          waste_pct?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          estimate_item_name?: string | null
          fixed_price?: number | null
          group_id?: string | null
          id?: string
          item_name?: string
          item_type?: string | null
          measurement_type?: string | null
          pricing_type?: string | null
          qty_formula?: string
          sort_order?: number
          template_id?: string
          unit?: string
          unit_cost?: number
          updated_at?: string
          waste_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "template_items_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "estimate_template_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          available_trades: string[] | null
          created_at: string
          currency: string
          id: string
          labor: Json
          name: string
          overhead: Json
          profit_margin_percent: number | null
          status: string
          supplier_id: string | null
          template_description: string | null
          template_type: string | null
          tenant_id: string
          updated_at: string
          use_for: string | null
        }
        Insert: {
          available_trades?: string[] | null
          created_at?: string
          currency?: string
          id?: string
          labor?: Json
          name: string
          overhead?: Json
          profit_margin_percent?: number | null
          status?: string
          supplier_id?: string | null
          template_description?: string | null
          template_type?: string | null
          tenant_id: string
          updated_at?: string
          use_for?: string | null
        }
        Update: {
          available_trades?: string[] | null
          created_at?: string
          currency?: string
          id?: string
          labor?: Json
          name?: string
          overhead?: Json
          profit_margin_percent?: number | null
          status?: string
          supplier_id?: string | null
          template_description?: string | null
          template_type?: string | null
          tenant_id?: string
          updated_at?: string
          use_for?: string | null
        }
        Relationships: []
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
      time_entries: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          break_duration_minutes: number | null
          clock_in: string
          clock_out: string | null
          created_at: string | null
          entry_date: string
          hourly_rate: number | null
          id: string
          labor_type: string | null
          location_coordinates: Json | null
          notes: string | null
          project_id: string | null
          status: string | null
          tenant_id: string
          total_cost: number | null
          total_hours: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          break_duration_minutes?: number | null
          clock_in: string
          clock_out?: string | null
          created_at?: string | null
          entry_date: string
          hourly_rate?: number | null
          id?: string
          labor_type?: string | null
          location_coordinates?: Json | null
          notes?: string | null
          project_id?: string | null
          status?: string | null
          tenant_id?: string
          total_cost?: number | null
          total_hours?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          break_duration_minutes?: number | null
          clock_in?: string
          clock_out?: string | null
          created_at?: string | null
          entry_date?: string
          hourly_rate?: number | null
          id?: string
          labor_type?: string | null
          location_coordinates?: Json | null
          notes?: string | null
          project_id?: string | null
          status?: string | null
          tenant_id?: string
          total_cost?: number | null
          total_hours?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transition_rules: {
        Row: {
          conditions: Json | null
          created_at: string | null
          created_by: string | null
          from_status: string
          id: string
          is_active: boolean | null
          job_type_filter: string[] | null
          max_value_threshold: number | null
          min_time_in_stage_hours: number | null
          min_value_threshold: number | null
          name: string
          required_role: string[] | null
          requires_approval: boolean | null
          requires_reason: boolean | null
          tenant_id: string
          to_status: string
          updated_at: string | null
        }
        Insert: {
          conditions?: Json | null
          created_at?: string | null
          created_by?: string | null
          from_status: string
          id?: string
          is_active?: boolean | null
          job_type_filter?: string[] | null
          max_value_threshold?: number | null
          min_time_in_stage_hours?: number | null
          min_value_threshold?: number | null
          name: string
          required_role?: string[] | null
          requires_approval?: boolean | null
          requires_reason?: boolean | null
          tenant_id: string
          to_status: string
          updated_at?: string | null
        }
        Update: {
          conditions?: Json | null
          created_at?: string | null
          created_by?: string | null
          from_status?: string
          id?: string
          is_active?: boolean | null
          job_type_filter?: string[] | null
          max_value_threshold?: number | null
          min_time_in_stage_hours?: number | null
          min_value_threshold?: number | null
          name?: string
          required_role?: string[] | null
          requires_approval?: boolean | null
          requires_reason?: boolean | null
          tenant_id?: string
          to_status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      transition_validations: {
        Row: {
          applies_to_status: string
          created_at: string | null
          created_by: string | null
          error_message: string
          id: string
          is_active: boolean | null
          name: string
          tenant_id: string
          validation_config: Json
          validation_type: string
        }
        Insert: {
          applies_to_status: string
          created_at?: string | null
          created_by?: string | null
          error_message: string
          id?: string
          is_active?: boolean | null
          name: string
          tenant_id: string
          validation_config: Json
          validation_type: string
        }
        Update: {
          applies_to_status?: string
          created_at?: string | null
          created_by?: string | null
          error_message?: string
          id?: string
          is_active?: boolean | null
          name?: string
          tenant_id?: string
          validation_config?: Json
          validation_type?: string
        }
        Relationships: []
      }
      user_achievements: {
        Row: {
          achievement_id: string
          created_at: string
          id: string
          progress: number | null
          progress_data: Json | null
          reward_claimed_at: string | null
          reward_sent_at: string | null
          reward_status: Database["public"]["Enums"]["reward_status"] | null
          reward_tracking: Json | null
          tenant_id: string
          unlocked_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          achievement_id: string
          created_at?: string
          id?: string
          progress?: number | null
          progress_data?: Json | null
          reward_claimed_at?: string | null
          reward_sent_at?: string | null
          reward_status?: Database["public"]["Enums"]["reward_status"] | null
          reward_tracking?: Json | null
          tenant_id: string
          unlocked_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          achievement_id?: string
          created_at?: string
          id?: string
          progress?: number | null
          progress_data?: Json | null
          reward_claimed_at?: string | null
          reward_sent_at?: string | null
          reward_status?: Database["public"]["Enums"]["reward_status"] | null
          reward_tracking?: Json | null
          tenant_id?: string
          unlocked_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "canvass_achievements"
            referencedColumns: ["id"]
          },
        ]
      }
      user_commission_assignments: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          commission_plan_id: string
          created_at: string | null
          id: string
          is_active: boolean | null
          notes: string | null
          tenant_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          commission_plan_id: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          tenant_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          commission_plan_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          tenant_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_commission_assignments_commission_plan_id_fkey"
            columns: ["commission_plan_id"]
            isOneToOne: false
            referencedRelation: "commission_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_commission_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      user_company_access: {
        Row: {
          access_level: string
          created_at: string
          granted_at: string
          granted_by: string | null
          id: string
          is_active: boolean
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_level?: string
          created_at?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          is_active?: boolean
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_level?: string
          created_at?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          is_active?: boolean
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_company_access_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_company_access_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_company_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_location_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          id: string
          is_active: boolean
          location_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          is_active?: boolean
          location_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          id?: string
          is_active?: boolean
          location_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: []
      }
      user_notifications: {
        Row: {
          created_at: string
          icon: string
          id: string
          is_read: boolean
          message: string
          metadata: Json | null
          tenant_id: string
          title: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          icon?: string
          id?: string
          is_read?: boolean
          message: string
          metadata?: Json | null
          tenant_id: string
          title: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          icon?: string
          id?: string
          is_read?: boolean
          message?: string
          metadata?: Json | null
          tenant_id?: string
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"] | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"] | null
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"] | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: []
      }
      vendor_order_items: {
        Row: {
          created_at: string | null
          id: string
          line_total: number | null
          order_id: string
          product_id: string
          quantity: number
          tenant_id: string
          unit_price: number
          vendor_sku: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          line_total?: number | null
          order_id: string
          product_id: string
          quantity: number
          tenant_id: string
          unit_price: number
          vendor_sku?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          line_total?: number | null
          order_id?: string
          product_id?: string
          quantity?: number
          tenant_id?: string
          unit_price?: number
          vendor_sku?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "vendor_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_orders: {
        Row: {
          actual_delivery_date: string | null
          created_at: string | null
          created_by: string | null
          expected_delivery_date: string | null
          id: string
          notes: string | null
          order_data: Json | null
          order_date: string | null
          order_number: string
          project_id: string | null
          shipping_address: Json | null
          status: string | null
          tenant_id: string
          total_amount: number | null
          tracking_data: Json | null
          updated_at: string | null
          vendor_id: string
          vendor_order_id: string | null
        }
        Insert: {
          actual_delivery_date?: string | null
          created_at?: string | null
          created_by?: string | null
          expected_delivery_date?: string | null
          id?: string
          notes?: string | null
          order_data?: Json | null
          order_date?: string | null
          order_number: string
          project_id?: string | null
          shipping_address?: Json | null
          status?: string | null
          tenant_id: string
          total_amount?: number | null
          tracking_data?: Json | null
          updated_at?: string | null
          vendor_id: string
          vendor_order_id?: string | null
        }
        Update: {
          actual_delivery_date?: string | null
          created_at?: string | null
          created_by?: string | null
          expected_delivery_date?: string | null
          id?: string
          notes?: string | null
          order_data?: Json | null
          order_date?: string | null
          order_number?: string
          project_id?: string | null
          shipping_address?: Json | null
          status?: string | null
          tenant_id?: string
          total_amount?: number | null
          tracking_data?: Json | null
          updated_at?: string | null
          vendor_id?: string
          vendor_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_orders_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_products: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          is_preferred: boolean | null
          lead_time_days: number | null
          minimum_order_qty: number | null
          product_id: string
          tenant_id: string
          updated_at: string | null
          vendor_id: string
          vendor_product_name: string | null
          vendor_sku: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          is_preferred?: boolean | null
          lead_time_days?: number | null
          minimum_order_qty?: number | null
          product_id: string
          tenant_id: string
          updated_at?: string | null
          vendor_id: string
          vendor_product_name?: string | null
          vendor_sku?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          is_preferred?: boolean | null
          lead_time_days?: number | null
          minimum_order_qty?: number | null
          product_id?: string
          tenant_id?: string
          updated_at?: string | null
          vendor_id?: string
          vendor_product_name?: string | null
          vendor_sku?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_products_vendor_id_fkey"
            columns: ["vendor_id"]
            isOneToOne: false
            referencedRelation: "vendors"
            referencedColumns: ["id"]
          },
        ]
      }
      vendors: {
        Row: {
          address: Json | null
          api_config: Json | null
          code: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string | null
          created_by: string | null
          id: string
          is_active: boolean | null
          name: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          address?: Json | null
          api_config?: Json | null
          code: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          address?: Json | null
          api_config?: Json | null
          code?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      walkthrough_analytics: {
        Row: {
          completed: boolean
          created_at: string
          dropped_off: boolean
          id: string
          step_id: string
          step_number: number
          tenant_id: string
          time_spent: number
          updated_at: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          dropped_off?: boolean
          id?: string
          step_id: string
          step_number: number
          tenant_id: string
          time_spent?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          dropped_off?: boolean
          id?: string
          step_id?: string
          step_number?: number
          tenant_id?: string
          time_spent?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "walkthrough_analytics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      weather_cache: {
        Row: {
          cached_at: string
          expires_at: string
          id: string
          risk_score: number
          tenant_id: string
          weather_data: Json
          zip_code: string
        }
        Insert: {
          cached_at?: string
          expires_at?: string
          id?: string
          risk_score: number
          tenant_id: string
          weather_data: Json
          zip_code: string
        }
        Update: {
          cached_at?: string
          expires_at?: string
          id?: string
          risk_score?: number
          tenant_id?: string
          weather_data?: Json
          zip_code?: string
        }
        Relationships: []
      }
      workflow_phase_history: {
        Row: {
          actions_taken: Json | null
          ai_reasoning: string | null
          created_at: string
          created_by: string | null
          from_phase: Database["public"]["Enums"]["workflow_phase"] | null
          id: string
          task_id: string
          tenant_id: string
          to_phase: Database["public"]["Enums"]["workflow_phase"]
        }
        Insert: {
          actions_taken?: Json | null
          ai_reasoning?: string | null
          created_at?: string
          created_by?: string | null
          from_phase?: Database["public"]["Enums"]["workflow_phase"] | null
          id?: string
          task_id: string
          tenant_id: string
          to_phase: Database["public"]["Enums"]["workflow_phase"]
        }
        Update: {
          actions_taken?: Json | null
          ai_reasoning?: string | null
          created_at?: string
          created_by?: string | null
          from_phase?: Database["public"]["Enums"]["workflow_phase"] | null
          id?: string
          task_id?: string
          tenant_id?: string
          to_phase?: Database["public"]["Enums"]["workflow_phase"]
        }
        Relationships: [
          {
            foreignKeyName: "workflow_phase_history_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "workflow_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_tasks: {
        Row: {
          ai_context: Json | null
          assigned_to: string | null
          completion_criteria: Json | null
          created_at: string
          created_by: string | null
          current_phase: Database["public"]["Enums"]["workflow_phase"]
          description: string | null
          due_date: string | null
          id: string
          is_active: boolean
          parent_task_id: string | null
          priority: string | null
          status: string | null
          task_name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ai_context?: Json | null
          assigned_to?: string | null
          completion_criteria?: Json | null
          created_at?: string
          created_by?: string | null
          current_phase?: Database["public"]["Enums"]["workflow_phase"]
          description?: string | null
          due_date?: string | null
          id?: string
          is_active?: boolean
          parent_task_id?: string | null
          priority?: string | null
          status?: string | null
          task_name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ai_context?: Json | null
          assigned_to?: string | null
          completion_criteria?: Json | null
          created_at?: string
          created_by?: string | null
          current_phase?: Database["public"]["Enums"]["workflow_phase"]
          description?: string | null
          due_date?: string | null
          id?: string
          is_active?: boolean
          parent_task_id?: string | null
          priority?: string | null
          status?: string | null
          task_name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "workflow_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_system_template: boolean | null
          name: string
          template_data: Json
          template_type: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_system_template?: boolean | null
          name: string
          template_data: Json
          template_type?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_system_template?: boolean | null
          name?: string
          template_data?: Json
          template_type?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflow_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      ai_usage_summary: {
        Row: {
          avg_response_time_ms: number | null
          error_count: number | null
          feature: string | null
          hour: string | null
          model: string | null
          payment_required_count: number | null
          provider: string | null
          rate_limited_count: number | null
          request_count: number | null
          success_count: number | null
          tenant_id: string | null
          total_completion_tokens: number | null
          total_cost_usd: number | null
          total_prompt_tokens: number | null
          total_tokens: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_metrics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      geography_columns: {
        Row: {
          coord_dimension: number | null
          f_geography_column: unknown
          f_table_catalog: unknown
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Relationships: []
      }
      geometry_columns: {
        Row: {
          coord_dimension: number | null
          f_geometry_column: unknown
          f_table_catalog: string | null
          f_table_name: unknown
          f_table_schema: unknown
          srid: number | null
          type: string | null
        }
        Insert: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Update: {
          coord_dimension?: number | null
          f_geometry_column?: unknown
          f_table_catalog?: string | null
          f_table_name?: unknown
          f_table_schema?: unknown
          srid?: number | null
          type?: string | null
        }
        Relationships: []
      }
      roof_daily_performance_metrics: {
        Row: {
          avg_accuracy: number | null
          avg_processing_time: number | null
          corrections_needed: number | null
          date: string | null
          total_cost: number | null
          total_measurements: number | null
        }
        Relationships: []
      }
      roof_measurement_summary: {
        Row: {
          area_accuracy_percent: number | null
          correction_count: number | null
          created_at: string | null
          facet_count: number | null
          id: string | null
          measurement_confidence: number | null
          predominant_pitch: string | null
          property_address: string | null
          total_area_adjusted_sqft: number | null
          total_squares: number | null
          user_satisfaction_rating: number | null
          validation_status: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _compute_budget_rollup: {
        Args: {
          p_commission: number
          p_lines: Json
          p_misc: number
          p_overhead: number
          p_sell_override?: number
        }
        Returns: Json
      }
      _jsonb_num: {
        Args: { default_val: number; key: string; v: Json }
        Returns: number
      }
      _postgis_deprecate: {
        Args: { newname: string; oldname: string; version: string }
        Returns: undefined
      }
      _postgis_index_extent: {
        Args: { col: string; tbl: unknown }
        Returns: unknown
      }
      _postgis_pgsql_version: { Args: never; Returns: string }
      _postgis_scripts_pgsql_version: { Args: never; Returns: string }
      _postgis_selectivity: {
        Args: { att_name: string; geom: unknown; mode?: string; tbl: unknown }
        Returns: number
      }
      _postgis_stats: {
        Args: { ""?: string; att_name: string; tbl: unknown }
        Returns: string
      }
      _st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_crosses: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      _st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      _st_intersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      _st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      _st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      _st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_sortablehash: { Args: { geom: unknown }; Returns: number }
      _st_touches: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      _st_voronoi: {
        Args: {
          clip?: unknown
          g1: unknown
          return_polygons?: boolean
          tolerance?: number
        }
        Returns: unknown
      }
      _st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      addauth: { Args: { "": string }; Returns: boolean }
      addgeometrycolumn:
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              column_name: string
              new_dim: number
              new_srid: number
              new_type: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              catalog_name: string
              column_name: string
              new_dim: number
              new_srid_in: number
              new_type: string
              schema_name: string
              table_name: string
              use_typmod?: boolean
            }
            Returns: string
          }
      api_approve_job_from_lead: {
        Args: { approval_notes?: string; pipeline_entry_id_param: string }
        Returns: Json
      }
      api_automations_create: {
        Args: {
          p_actions?: Json
          p_description?: string
          p_name: string
          p_trigger_conditions?: Json
          p_trigger_type?: string
        }
        Returns: string
      }
      api_automations_update: {
        Args: {
          p_actions?: Json
          p_description?: string
          p_id: string
          p_name?: string
          p_trigger_conditions?: Json
        }
        Returns: boolean
      }
      api_capout_refresh: { Args: { p_job_id: string }; Returns: Json }
      api_create_material_order_from_estimate: {
        Args: {
          p_branch_code?: string
          p_delivery_address?: Json
          p_estimate_id: string
          p_notes?: string
          p_vendor_id: string
        }
        Returns: string
      }
      api_dynamic_tags_frequently_used: {
        Args: { p_limit?: number }
        Returns: {
          description: string
          id: string
          json_path: string
          label: string
          sample_value: string
          token: string
        }[]
      }
      api_estimate_bind_template: {
        Args: { p_estimate_id: string; p_template_id: string }
        Returns: undefined
      }
      api_estimate_compute_pricing: {
        Args: {
          p_currency?: string
          p_estimate_id: string
          p_mode?: string
          p_pct?: number
        }
        Returns: {
          cost_pre_profit: number
          currency: string
          estimate_id: string
          labor: number
          margin_pct: number
          markup_pct: number
          materials: number
          mode: string
          overhead: number
          profit: number
          sale_price: number
        }[]
      }
      api_estimate_hyperlink_bar: {
        Args: { p_estimate_id: string }
        Returns: Json
      }
      api_estimate_items_get: {
        Args: { p_estimate_id: string }
        Returns: {
          item_name: string
          line_total: number
          qty: number
          template_item_id: string
          unit_cost: number
        }[]
      }
      api_estimate_measurements_upsert: {
        Args: { p_estimate_id: string; p_payload: Json }
        Returns: undefined
      }
      api_estimate_status_get: {
        Args: { p_estimate_id: string }
        Returns: Json
      }
      api_job_budgets_get: {
        Args: { p_job_id: string }
        Returns: {
          created_at: string
          estimate_ref: string | null
          id: string
          job_id: string
          kind: string
          lines: Json
          locked: boolean
          summary: Json
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "job_budget_versions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      api_qbo_map_job_invoice: {
        Args: {
          p_doc_number: string
          p_job_id: string
          p_qbo_invoice_id: string
          p_realm_id: string
        }
        Returns: string
      }
      api_qbo_set_connection: {
        Args: {
          p_access_token: string
          p_company_name?: string
          p_expires_at: string
          p_realm_id: string
          p_refresh_token: string
          p_scopes: string[]
        }
        Returns: string
      }
      api_qbo_update_invoice_mirror: {
        Args: {
          p_balance: number
          p_doc_number: string
          p_qbo_invoice_id: string
          p_realm_id: string
          p_status?: string
          p_total: number
        }
        Returns: string
      }
      api_request_manager_approval: {
        Args: {
          business_justification_param?: string
          estimated_value_param?: number
          pipeline_entry_id_param: string
        }
        Returns: Json
      }
      api_save_call_disposition: {
        Args: { p_call_id: string; p_disposition: string; p_notes?: string }
        Returns: undefined
      }
      api_smartdoc_build_context: {
        Args: { p_extra?: Json; p_job_id?: string; p_lead_id?: string }
        Returns: Json
      }
      api_smartdoc_templates_get: {
        Args: { p_id: string }
        Returns: {
          category: string
          content: string
          created_at: string | null
          description: string | null
          id: string
          is_system: boolean | null
          slug: string
          status: string | null
          tenant_id: string
          title: string
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "smart_doc_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      api_smartdoc_templates_list: {
        Args: never
        Returns: {
          category: string
          content: string
          created_at: string | null
          description: string | null
          id: string
          is_system: boolean | null
          slug: string
          status: string | null
          tenant_id: string
          title: string
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "smart_doc_templates"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      api_snapshot_precap_and_capout: {
        Args: {
          p_commission_amount?: number
          p_estimate_ref?: string
          p_job_id: string
          p_lines: Json
          p_misc_amount?: number
          p_overhead_amount?: number
        }
        Returns: {
          capout_id: string
          precap_id: string
        }[]
      }
      api_template_get_full: { Args: { p_template_id: string }; Returns: Json }
      api_template_items_get: {
        Args: { p_template_id: string }
        Returns: {
          active: boolean
          id: string
          item_name: string
          qty_formula: string
          sort_order: number
          unit: string
          unit_cost: number
          waste_pct: number
        }[]
      }
      api_template_items_upsert: {
        Args: { p_items: Json; p_template_id: string }
        Returns: undefined
      }
      api_templates_create: {
        Args: {
          p_currency?: string
          p_labor: Json
          p_name: string
          p_overhead: Json
        }
        Returns: string
      }
      calculate_enhanced_estimate: {
        Args: { estimate_id_param: string }
        Returns: Json
      }
      calculate_enhanced_rep_commission: {
        Args: { project_id_param: string; sales_rep_id_param: string }
        Returns: Json
      }
      calculate_lead_score: {
        Args: { contact_data: Json; tenant_id_param: string }
        Returns: number
      }
      calculate_name_similarity: {
        Args: { name1: string; name2: string }
        Returns: number
      }
      calculate_perimeter_from_linear_features: {
        Args: { linear_features: Json }
        Returns: number
      }
      calculate_price_change_pct: {
        Args: { new_price: number; old_price: number }
        Returns: number
      }
      calculate_rep_commission: {
        Args: { project_id_param: string; sales_rep_id_param: string }
        Returns: Json
      }
      check_enrollment_eligibility: {
        Args: { campaign_conditions: Json; contact_data: Json }
        Returns: boolean
      }
      check_location_radius: {
        Args: {
          radius_miles?: number
          target_lat: number
          target_lng: number
          user_location: Json
        }
        Returns: boolean
      }
      check_rate_limit: {
        Args: {
          p_limit: number
          p_resource: string
          p_user_id: string
          p_window_minutes: number
        }
        Returns: Json
      }
      check_subcontractor_capacity: {
        Args: { check_date: string; sub_id: string; tenant_id_param: string }
        Returns: boolean
      }
      cleanup_expired_canvass_sessions: { Args: never; Returns: undefined }
      cleanup_old_rate_limits: { Args: never; Returns: undefined }
      complete_presentation_session: {
        Args: { p_session_id: string; p_signature_data?: Json }
        Returns: undefined
      }
      determine_approval_requirements: {
        Args: { p_order_amount: number; p_tenant_id: string }
        Returns: {
          approval_type: string
          required_approvers: Json
          rule_id: string
          rule_name: string
        }[]
      }
      disablelongtransactions: { Args: never; Returns: string }
      dropgeometrycolumn:
        | {
            Args: {
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
        | { Args: { column_name: string; table_name: string }; Returns: string }
        | {
            Args: {
              catalog_name: string
              column_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
      dropgeometrytable:
        | { Args: { schema_name: string; table_name: string }; Returns: string }
        | { Args: { table_name: string }; Returns: string }
        | {
            Args: {
              catalog_name: string
              schema_name: string
              table_name: string
            }
            Returns: string
          }
      enablelongtransactions: { Args: never; Returns: string }
      equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      est_bind_template: {
        Args: { p_estimate_id: string; p_template_id: string }
        Returns: undefined
      }
      est_compute_pricing: {
        Args: {
          p_currency?: string
          p_estimate_id: string
          p_mode?: string
          p_pct?: number
        }
        Returns: {
          cost_pre_profit: number
          currency: string
          estimate_id: string
          labor: number
          margin_pct: number
          markup_pct: number
          materials: number
          mode: string
          overhead: number
          profit: number
          sale_price: number
        }[]
      }
      est_eval_qty: { Args: { expr: string; vars: Json }; Returns: number }
      est_ingest_measurements: {
        Args: { p_estimate_id: string; p_payload: Json }
        Returns: undefined
      }
      est_sanitize_formula: { Args: { expr: string }; Returns: string }
      extract_tokens: { Args: { t: string }; Returns: string[] }
      format_clj_number: {
        Args: { contact_num: number; job_num?: number; lead_num?: number }
        Returns: string
      }
      generate_clj_number: { Args: never; Returns: string }
      generate_contact_number: { Args: never; Returns: string }
      generate_envelope_number: { Args: never; Returns: string }
      generate_job_number: { Args: never; Returns: string }
      generate_po_number: { Args: never; Returns: string }
      generate_presentation_token: {
        Args: {
          p_contact_id?: string
          p_expires_in?: unknown
          p_presentation_id: string
        }
        Returns: string
      }
      generate_project_job_number: { Args: never; Returns: string }
      generate_signature_access_token: { Args: never; Returns: string }
      generate_simple_job_number: { Args: never; Returns: string }
      geometry: { Args: { "": string }; Returns: unknown }
      geometry_above: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_below: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_cmp: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_contained_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_contains_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_distance_box: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_distance_centroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      geometry_eq: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_ge: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_gt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_le: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_left: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_lt: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overabove: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overbelow: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overlaps_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overleft: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_overright: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_right: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_same_3d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geometry_within: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      geomfromewkt: { Args: { "": string }; Returns: unknown }
      get_ai_usage_stats: {
        Args: { p_hours_back?: number; p_tenant_id: string }
        Returns: Json
      }
      get_next_contact_number: {
        Args: { tenant_id_param: string }
        Returns: number
      }
      get_next_job_number: { Args: { lead_id_param: string }; Returns: number }
      get_next_lead_number: {
        Args: { contact_id_param: string }
        Returns: number
      }
      get_user_accessible_tenants: {
        Args: never
        Returns: {
          access_level: string
          is_primary: boolean
          location_count: number
          tenant_id: string
          tenant_name: string
          tenant_subdomain: string
        }[]
      }
      get_user_active_tenant_id: { Args: never; Returns: string }
      get_user_tenant_id:
        | { Args: never; Returns: string }
        | { Args: { _user_id: string }; Returns: string }
      gettransactionid: { Args: never; Returns: unknown }
      has_high_level_role: { Args: { p_user_id: string }; Returns: boolean }
      increment_campaign_answered: {
        Args: { p_campaign_id: string }
        Returns: undefined
      }
      increment_campaign_attempts: {
        Args: { p_campaign_id: string }
        Returns: undefined
      }
      increment_campaign_bridged: {
        Args: { p_campaign_id: string }
        Returns: undefined
      }
      insert_measurement: {
        Args: {
          p_created_by: string
          p_faces: Json
          p_geom_wkt: string
          p_linear_features?: Json
          p_property_id: string
          p_source: string
          p_summary: Json
        }
        Returns: {
          created_at: string
          created_by: string | null
          faces: Json
          geom_geog: unknown
          id: string
          is_active: boolean
          linear_features: Json | null
          mapbox_visualization_url: string | null
          penetrations: Json
          property_id: string
          source: string
          summary: Json
          supersedes: string | null
          updated_at: string
          version: number
          visualization_generated_at: string | null
          visualization_metadata: Json | null
        }
        SetofOptions: {
          from: "*"
          to: "measurements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_order_fully_approved: { Args: { p_po_id: string }; Returns: boolean }
      jsonb_get_path: { Args: { obj: Json; path: string }; Returns: string }
      log_company_activity: {
        Args: {
          p_action_description: string
          p_action_type: string
          p_metadata?: Json
          p_resource_id?: string
          p_resource_type?: string
          p_severity?: string
          p_tenant_id: string
        }
        Returns: string
      }
      log_function_error: {
        Args: {
          p_context?: Json
          p_error_message: string
          p_error_stack?: string
          p_function_name: string
        }
        Returns: string
      }
      log_signature_event: {
        Args: {
          p_description?: string
          p_envelope_id: string
          p_event_type: string
          p_metadata?: Json
          p_recipient_id: string
        }
        Returns: string
      }
      longtransactionsenabled: { Args: never; Returns: boolean }
      nearby_buildings: {
        Args: {
          p_lat: number
          p_lng: number
          p_max_age_days?: number
          p_radius_m?: number
        }
        Returns: {
          building_polygon: Json
          confidence_score: number | null
          created_at: string | null
          geom_geog: unknown
          id: string
          imagery_date: string | null
          last_verified_at: string | null
          lat: number
          lng: number
          roof_segments: Json | null
          source: string
          updated_at: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "building_footprints"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      normalize_email: { Args: { email_text: string }; Returns: string }
      normalize_phone: { Args: { phone_text: string }; Returns: string }
      populate_geometry_columns:
        | { Args: { use_typmod?: boolean }; Returns: string }
        | { Args: { tbl_oid: unknown; use_typmod?: boolean }; Returns: number }
      postgis_constraint_dims: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_srid: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: number
      }
      postgis_constraint_type: {
        Args: { geomcolumn: string; geomschema: string; geomtable: string }
        Returns: string
      }
      postgis_extensions_upgrade: { Args: never; Returns: string }
      postgis_full_version: { Args: never; Returns: string }
      postgis_geos_version: { Args: never; Returns: string }
      postgis_lib_build_date: { Args: never; Returns: string }
      postgis_lib_revision: { Args: never; Returns: string }
      postgis_lib_version: { Args: never; Returns: string }
      postgis_libjson_version: { Args: never; Returns: string }
      postgis_liblwgeom_version: { Args: never; Returns: string }
      postgis_libprotobuf_version: { Args: never; Returns: string }
      postgis_libxml_version: { Args: never; Returns: string }
      postgis_proj_version: { Args: never; Returns: string }
      postgis_scripts_build_date: { Args: never; Returns: string }
      postgis_scripts_installed: { Args: never; Returns: string }
      postgis_scripts_released: { Args: never; Returns: string }
      postgis_svn_version: { Args: never; Returns: string }
      postgis_type_name: {
        Args: {
          coord_dimension: number
          geomname: string
          use_new_name?: boolean
        }
        Returns: string
      }
      postgis_version: { Args: never; Returns: string }
      postgis_wagyu_version: { Args: never; Returns: string }
      process_smart_words: {
        Args: {
          context_data: Json
          template_content: string
          tenant_id_param: string
        }
        Returns: string
      }
      rollback_estimate_to_version: {
        Args: { estimate_id_param: string; version_id_param: string }
        Returns: boolean
      }
      seed_dynamic_tags: { Args: { p_tenant_id: string }; Returns: undefined }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      soft_delete_contact: {
        Args: { contact_id_param: string }
        Returns: boolean
      }
      st_3dclosestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3ddistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dintersects: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_3dlongestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmakebox: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_3dmaxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_3dshortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_addpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_angle:
        | { Args: { line1: unknown; line2: unknown }; Returns: number }
        | {
            Args: { pt1: unknown; pt2: unknown; pt3: unknown; pt4?: unknown }
            Returns: number
          }
      st_area:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_asencodedpolyline: {
        Args: { geom: unknown; nprecision?: number }
        Returns: string
      }
      st_asewkt: { Args: { "": string }; Returns: string }
      st_asgeojson:
        | {
            Args: {
              geom_column?: string
              maxdecimaldigits?: number
              pretty_bool?: boolean
              r: Record<string, unknown>
            }
            Returns: string
          }
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_asgml:
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
              version: number
            }
            Returns: string
          }
        | {
            Args: {
              geog: unknown
              id?: string
              maxdecimaldigits?: number
              nprefix?: string
              options?: number
            }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_askml:
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; nprefix?: string }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_aslatlontext: {
        Args: { geom: unknown; tmpl?: string }
        Returns: string
      }
      st_asmarc21: { Args: { format?: string; geom: unknown }; Returns: string }
      st_asmvtgeom: {
        Args: {
          bounds: unknown
          buffer?: number
          clip_geom?: boolean
          extent?: number
          geom: unknown
        }
        Returns: unknown
      }
      st_assvg:
        | {
            Args: { geom: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | {
            Args: { geog: unknown; maxdecimaldigits?: number; rel?: number }
            Returns: string
          }
        | { Args: { "": string }; Returns: string }
      st_astext: { Args: { "": string }; Returns: string }
      st_astwkb:
        | {
            Args: {
              geom: unknown[]
              ids: number[]
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
        | {
            Args: {
              geom: unknown
              prec?: number
              prec_m?: number
              prec_z?: number
              with_boxes?: boolean
              with_sizes?: boolean
            }
            Returns: string
          }
      st_asx3d: {
        Args: { geom: unknown; maxdecimaldigits?: number; options?: number }
        Returns: string
      }
      st_azimuth:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | { Args: { geog1: unknown; geog2: unknown }; Returns: number }
      st_boundingdiagonal: {
        Args: { fits?: boolean; geom: unknown }
        Returns: unknown
      }
      st_buffer:
        | {
            Args: { geom: unknown; options?: string; radius: number }
            Returns: unknown
          }
        | {
            Args: { geom: unknown; quadsegs: number; radius: number }
            Returns: unknown
          }
      st_centroid: { Args: { "": string }; Returns: unknown }
      st_clipbybox2d: {
        Args: { box: unknown; geom: unknown }
        Returns: unknown
      }
      st_closestpoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_collect: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_concavehull: {
        Args: {
          param_allow_holes?: boolean
          param_geom: unknown
          param_pctconvex: number
        }
        Returns: unknown
      }
      st_contains: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_containsproperly: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_coorddim: { Args: { geometry: unknown }; Returns: number }
      st_coveredby:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_covers:
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_crosses: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_curvetoline: {
        Args: { flags?: number; geom: unknown; tol?: number; toltype?: number }
        Returns: unknown
      }
      st_delaunaytriangles: {
        Args: { flags?: number; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_difference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_disjoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_distance:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geog1: unknown; geog2: unknown; use_spheroid?: boolean }
            Returns: number
          }
      st_distancesphere:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: number }
        | {
            Args: { geom1: unknown; geom2: unknown; radius: number }
            Returns: number
          }
      st_distancespheroid: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_dwithin: {
        Args: {
          geog1: unknown
          geog2: unknown
          tolerance: number
          use_spheroid?: boolean
        }
        Returns: boolean
      }
      st_equals: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_expand:
        | {
            Args: {
              dm?: number
              dx: number
              dy: number
              dz?: number
              geom: unknown
            }
            Returns: unknown
          }
        | {
            Args: { box: unknown; dx: number; dy: number; dz?: number }
            Returns: unknown
          }
        | { Args: { box: unknown; dx: number; dy: number }; Returns: unknown }
      st_force3d: { Args: { geom: unknown; zvalue?: number }; Returns: unknown }
      st_force3dm: {
        Args: { geom: unknown; mvalue?: number }
        Returns: unknown
      }
      st_force3dz: {
        Args: { geom: unknown; zvalue?: number }
        Returns: unknown
      }
      st_force4d: {
        Args: { geom: unknown; mvalue?: number; zvalue?: number }
        Returns: unknown
      }
      st_generatepoints:
        | { Args: { area: unknown; npoints: number }; Returns: unknown }
        | {
            Args: { area: unknown; npoints: number; seed: number }
            Returns: unknown
          }
      st_geogfromtext: { Args: { "": string }; Returns: unknown }
      st_geographyfromtext: { Args: { "": string }; Returns: unknown }
      st_geohash:
        | { Args: { geom: unknown; maxchars?: number }; Returns: string }
        | { Args: { geog: unknown; maxchars?: number }; Returns: string }
      st_geomcollfromtext: { Args: { "": string }; Returns: unknown }
      st_geometricmedian: {
        Args: {
          fail_if_not_converged?: boolean
          g: unknown
          max_iter?: number
          tolerance?: number
        }
        Returns: unknown
      }
      st_geometryfromtext: { Args: { "": string }; Returns: unknown }
      st_geomfromewkt: { Args: { "": string }; Returns: unknown }
      st_geomfromgeojson:
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": Json }; Returns: unknown }
        | { Args: { "": string }; Returns: unknown }
      st_geomfromgml: { Args: { "": string }; Returns: unknown }
      st_geomfromkml: { Args: { "": string }; Returns: unknown }
      st_geomfrommarc21: { Args: { marc21xml: string }; Returns: unknown }
      st_geomfromtext: { Args: { "": string }; Returns: unknown }
      st_gmltosql: { Args: { "": string }; Returns: unknown }
      st_hasarc: { Args: { geometry: unknown }; Returns: boolean }
      st_hausdorffdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_hexagon: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_hexagongrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_interpolatepoint: {
        Args: { line: unknown; point: unknown }
        Returns: number
      }
      st_intersection: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_intersects:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
        | { Args: { geog1: unknown; geog2: unknown }; Returns: boolean }
      st_isvaliddetail: {
        Args: { flags?: number; geom: unknown }
        Returns: Database["public"]["CompositeTypes"]["valid_detail"]
        SetofOptions: {
          from: "*"
          to: "valid_detail"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      st_length:
        | { Args: { geog: unknown; use_spheroid?: boolean }; Returns: number }
        | { Args: { "": string }; Returns: number }
      st_letters: { Args: { font?: Json; letters: string }; Returns: unknown }
      st_linecrossingdirection: {
        Args: { line1: unknown; line2: unknown }
        Returns: number
      }
      st_linefromencodedpolyline: {
        Args: { nprecision?: number; txtin: string }
        Returns: unknown
      }
      st_linefromtext: { Args: { "": string }; Returns: unknown }
      st_linelocatepoint: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_linetocurve: { Args: { geometry: unknown }; Returns: unknown }
      st_locatealong: {
        Args: { geometry: unknown; leftrightoffset?: number; measure: number }
        Returns: unknown
      }
      st_locatebetween: {
        Args: {
          frommeasure: number
          geometry: unknown
          leftrightoffset?: number
          tomeasure: number
        }
        Returns: unknown
      }
      st_locatebetweenelevations: {
        Args: { fromelevation: number; geometry: unknown; toelevation: number }
        Returns: unknown
      }
      st_longestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makebox2d: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makeline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_makevalid: {
        Args: { geom: unknown; params: string }
        Returns: unknown
      }
      st_maxdistance: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: number
      }
      st_minimumboundingcircle: {
        Args: { inputgeom: unknown; segs_per_quarter?: number }
        Returns: unknown
      }
      st_mlinefromtext: { Args: { "": string }; Returns: unknown }
      st_mpointfromtext: { Args: { "": string }; Returns: unknown }
      st_mpolyfromtext: { Args: { "": string }; Returns: unknown }
      st_multilinestringfromtext: { Args: { "": string }; Returns: unknown }
      st_multipointfromtext: { Args: { "": string }; Returns: unknown }
      st_multipolygonfromtext: { Args: { "": string }; Returns: unknown }
      st_node: { Args: { g: unknown }; Returns: unknown }
      st_normalize: { Args: { geom: unknown }; Returns: unknown }
      st_offsetcurve: {
        Args: { distance: number; line: unknown; params?: string }
        Returns: unknown
      }
      st_orderingequals: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_overlaps: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: boolean
      }
      st_perimeter: {
        Args: { geog: unknown; use_spheroid?: boolean }
        Returns: number
      }
      st_pointfromtext: { Args: { "": string }; Returns: unknown }
      st_pointm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
        }
        Returns: unknown
      }
      st_pointz: {
        Args: {
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_pointzm: {
        Args: {
          mcoordinate: number
          srid?: number
          xcoordinate: number
          ycoordinate: number
          zcoordinate: number
        }
        Returns: unknown
      }
      st_polyfromtext: { Args: { "": string }; Returns: unknown }
      st_polygonfromtext: { Args: { "": string }; Returns: unknown }
      st_project: {
        Args: { azimuth: number; distance: number; geog: unknown }
        Returns: unknown
      }
      st_quantizecoordinates: {
        Args: {
          g: unknown
          prec_m?: number
          prec_x: number
          prec_y?: number
          prec_z?: number
        }
        Returns: unknown
      }
      st_reduceprecision: {
        Args: { geom: unknown; gridsize: number }
        Returns: unknown
      }
      st_relate: { Args: { geom1: unknown; geom2: unknown }; Returns: string }
      st_removerepeatedpoints: {
        Args: { geom: unknown; tolerance?: number }
        Returns: unknown
      }
      st_segmentize: {
        Args: { geog: unknown; max_segment_length: number }
        Returns: unknown
      }
      st_setsrid:
        | { Args: { geom: unknown; srid: number }; Returns: unknown }
        | { Args: { geog: unknown; srid: number }; Returns: unknown }
      st_sharedpaths: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_shortestline: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_simplifypolygonhull: {
        Args: { geom: unknown; is_outer?: boolean; vertex_fraction: number }
        Returns: unknown
      }
      st_split: { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
      st_square: {
        Args: { cell_i: number; cell_j: number; origin?: unknown; size: number }
        Returns: unknown
      }
      st_squaregrid: {
        Args: { bounds: unknown; size: number }
        Returns: Record<string, unknown>[]
      }
      st_srid:
        | { Args: { geom: unknown }; Returns: number }
        | { Args: { geog: unknown }; Returns: number }
      st_subdivide: {
        Args: { geom: unknown; gridsize?: number; maxvertices?: number }
        Returns: unknown[]
      }
      st_swapordinates: {
        Args: { geom: unknown; ords: unknown }
        Returns: unknown
      }
      st_symdifference: {
        Args: { geom1: unknown; geom2: unknown; gridsize?: number }
        Returns: unknown
      }
      st_symmetricdifference: {
        Args: { geom1: unknown; geom2: unknown }
        Returns: unknown
      }
      st_tileenvelope: {
        Args: {
          bounds?: unknown
          margin?: number
          x: number
          y: number
          zoom: number
        }
        Returns: unknown
      }
      st_touches: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_transform:
        | { Args: { geom: unknown; to_proj: string }; Returns: unknown }
        | {
            Args: { from_proj: string; geom: unknown; to_srid: number }
            Returns: unknown
          }
        | {
            Args: { from_proj: string; geom: unknown; to_proj: string }
            Returns: unknown
          }
      st_triangulatepolygon: { Args: { g1: unknown }; Returns: unknown }
      st_union:
        | { Args: { geom1: unknown; geom2: unknown }; Returns: unknown }
        | {
            Args: { geom1: unknown; geom2: unknown; gridsize: number }
            Returns: unknown
          }
      st_voronoilines: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_voronoipolygons: {
        Args: { extend_to?: unknown; g1: unknown; tolerance?: number }
        Returns: unknown
      }
      st_within: { Args: { geom1: unknown; geom2: unknown }; Returns: boolean }
      st_wkbtosql: { Args: { wkb: string }; Returns: unknown }
      st_wkttosql: { Args: { "": string }; Returns: unknown }
      st_wrapx: {
        Args: { geom: unknown; move: number; wrap: number }
        Returns: unknown
      }
      start_presentation_session: {
        Args: {
          p_access_token?: string
          p_contact_id?: string
          p_presentation_id: string
        }
        Returns: string
      }
      switch_active_tenant: { Args: { p_tenant_id: string }; Returns: Json }
      switch_developer_context: {
        Args: { target_tenant_id: string }
        Returns: boolean
      }
      track_slide_view: {
        Args: {
          p_session_id: string
          p_slide_id: string
          p_time_spent?: number
        }
        Returns: undefined
      }
      unlockrows: { Args: { "": string }; Returns: number }
      update_cache_access_stats: {
        Args: { p_cache_key: string }
        Returns: undefined
      }
      update_campaign_avg_talk_time: {
        Args: { p_campaign_id: string; p_duration: number }
        Returns: undefined
      }
      updategeometrysrid: {
        Args: {
          catalogn_name: string
          column_name: string
          new_srid_in: number
          schema_name: string
          table_name: string
        }
        Returns: string
      }
      validate_canvass_token: {
        Args: { p_token: string }
        Returns: {
          tenant_id: string
          user_id: string
        }[]
      }
      validate_presentation_token: {
        Args: { p_presentation_id: string; p_token: string }
        Returns: string
      }
    }
    Enums: {
      achievement_tier: "bronze" | "silver" | "gold" | "platinum" | "diamond"
      achievement_type: "milestone" | "skill" | "streak" | "special"
      app_role:
        | "master"
        | "corporate"
        | "office_admin"
        | "regional_manager"
        | "sales_manager"
        | "project_manager"
      commission_structure_type:
        | "profit_split"
        | "sales_percentage"
        | "tiered"
        | "flat_rate"
      commission_type:
        | "gross_percent"
        | "net_percent"
        | "tiered_margin"
        | "flat_fee"
      competition_status: "draft" | "active" | "completed" | "cancelled"
      competition_type: "daily" | "weekly" | "monthly" | "custom"
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
      job_status:
        | "lead"
        | "legal"
        | "contingency"
        | "ready_for_approval"
        | "production"
        | "final_payment"
        | "closed"
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
        | "hold_mgr_review"
        | "legal"
        | "contingency"
        | "ready_for_approval"
        | "production"
        | "final_payment"
      reward_status:
        | "pending"
        | "processing"
        | "sent"
        | "delivered"
        | "claimed"
        | "failed"
      reward_type: "cash" | "gift_card" | "physical" | "points" | "badge"
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
      workflow_phase:
        | "planning"
        | "implementation"
        | "testing"
        | "deployment"
        | "monitoring"
        | "optimization"
    }
    CompositeTypes: {
      geometry_dump: {
        path: number[] | null
        geom: unknown
      }
      valid_detail: {
        valid: boolean | null
        reason: string | null
        location: unknown
      }
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
      achievement_tier: ["bronze", "silver", "gold", "platinum", "diamond"],
      achievement_type: ["milestone", "skill", "streak", "special"],
      app_role: [
        "master",
        "corporate",
        "office_admin",
        "regional_manager",
        "sales_manager",
        "project_manager",
      ],
      commission_structure_type: [
        "profit_split",
        "sales_percentage",
        "tiered",
        "flat_rate",
      ],
      commission_type: [
        "gross_percent",
        "net_percent",
        "tiered_margin",
        "flat_fee",
      ],
      competition_status: ["draft", "active", "completed", "cancelled"],
      competition_type: ["daily", "weekly", "monthly", "custom"],
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
      job_status: [
        "lead",
        "legal",
        "contingency",
        "ready_for_approval",
        "production",
        "final_payment",
        "closed",
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
        "hold_mgr_review",
        "legal",
        "contingency",
        "ready_for_approval",
        "production",
        "final_payment",
      ],
      reward_status: [
        "pending",
        "processing",
        "sent",
        "delivered",
        "claimed",
        "failed",
      ],
      reward_type: ["cash", "gift_card", "physical", "points", "badge"],
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
      workflow_phase: [
        "planning",
        "implementation",
        "testing",
        "deployment",
        "monitoring",
        "optimization",
      ],
    },
  },
} as const
