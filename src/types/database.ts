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
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      achievements: {
        Row: {
          condition: Json
          created_at: string
          description: Json
          icon: string
          key: string
          name: Json
          position: number
        }
        Insert: {
          condition: Json
          created_at?: string
          description: Json
          icon: string
          key: string
          name: Json
          position?: number
        }
        Update: {
          condition?: Json
          created_at?: string
          description?: Json
          icon?: string
          key?: string
          name?: Json
          position?: number
        }
        Relationships: []
      }
      admin_audit: {
        Row: {
          created_at: string
          id: number
          ip_hash: string | null
          kind: Database["public"]["Enums"]["admin_audit_kind"]
          target: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: never
          ip_hash?: string | null
          kind: Database["public"]["Enums"]["admin_audit_kind"]
          target: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: never
          ip_hash?: string | null
          kind?: Database["public"]["Enums"]["admin_audit_kind"]
          target?: string
          user_id?: string | null
        }
        Relationships: []
      }
      admin_login_attempts: {
        Row: {
          created_at: string
          email_hash: string | null
          id: number
          ip_hash: string
          stage: string
          success: boolean
        }
        Insert: {
          created_at?: string
          email_hash?: string | null
          id?: never
          ip_hash: string
          stage: string
          success: boolean
        }
        Update: {
          created_at?: string
          email_hash?: string | null
          id?: never
          ip_hash?: string
          stage?: string
          success?: boolean
        }
        Relationships: []
      }
      admin_sessions: {
        Row: {
          ended_at: string | null
          last_seen_at: string
          session_id: string
          started_at: string
          user_id: string
        }
        Insert: {
          ended_at?: string | null
          last_seen_at?: string
          session_id: string
          started_at: string
          user_id: string
        }
        Update: {
          ended_at?: string | null
          last_seen_at?: string
          session_id?: string
          started_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_usage: {
        Row: {
          cache_read_tokens: number
          cache_write_tokens: number
          conversation_id: string | null
          cost_usd: number
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          input_tokens: number
          model: string
          output_tokens: number
          purpose: string
          success: boolean
          user_id: string
        }
        Insert: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          conversation_id?: string | null
          cost_usd?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          input_tokens?: number
          model: string
          output_tokens?: number
          purpose: string
          success?: boolean
          user_id: string
        }
        Update: {
          cache_read_tokens?: number
          cache_write_tokens?: number
          conversation_id?: string | null
          cost_usd?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
          purpose?: string
          success?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_conversation_id_fkey"
            columns: ["conversation_id", "user_id"]
            isOneToOne: false
            referencedRelation: "jarvis_conversations"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      analytics_event_catalog: {
        Row: {
          active: boolean
          event: string
          section: string
        }
        Insert: {
          active: boolean
          event: string
          section: string
        }
        Update: {
          active?: boolean
          event?: string
          section?: string
        }
        Relationships: []
      }
      analytics_events: {
        Row: {
          created_at: string
          device: string | null
          event: string
          game_mode: string | null
          id: number
          locale: string | null
          owner_id: string | null
          plan_key: string | null
          props: Json
          session_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          device?: string | null
          event: string
          game_mode?: string | null
          id?: never
          locale?: string | null
          owner_id?: string | null
          plan_key?: string | null
          props?: Json
          session_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          device?: string | null
          event?: string
          game_mode?: string | null
          id?: never
          locale?: string | null
          owner_id?: string | null
          plan_key?: string | null
          props?: Json
          session_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analytics_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "app_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      analytics_rate_limits: {
        Row: {
          used: number
          user_id: string
          window_start: string
        }
        Insert: {
          used?: number
          user_id: string
          window_start: string
        }
        Update: {
          used?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      app_sessions: {
        Row: {
          browser: string
          device: string
          id: string
          last_seen_at: string
          started_at: string
          user_id: string
        }
        Insert: {
          browser?: string
          device?: string
          id?: string
          last_seen_at?: string
          started_at?: string
          user_id: string
        }
        Update: {
          browser?: string
          device?: string
          id?: string
          last_seen_at?: string
          started_at?: string
          user_id?: string
        }
        Relationships: []
      }
      attachments: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
          extracted_text: string | null
          file_name: string
          id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          entity_type: string
          extracted_text?: string | null
          file_name: string
          id?: string
          mime_type: string
          size_bytes: number
          storage_path: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          entity_type?: string
          extracted_text?: string | null
          file_name?: string
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      calendar_events: {
        Row: {
          actor_id: string | null
          all_day: boolean
          contact_id: string | null
          created_at: string
          deal_id: string | null
          description: string | null
          ends_at: string | null
          id: string
          kind: Database["public"]["Enums"]["calendar_event_kind"]
          location: string | null
          source: string
          starts_at: string
          task_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          all_day?: boolean
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["calendar_event_kind"]
          location?: string | null
          source?: string
          starts_at: string
          task_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          all_day?: boolean
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["calendar_event_kind"]
          location?: string | null
          source?: string
          starts_at?: string
          task_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_contact_id_fkey"
            columns: ["contact_id", "user_id"]
            isOneToOne: false
            referencedRelation: "contact_list"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "calendar_events_contact_id_fkey"
            columns: ["contact_id", "user_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "calendar_events_deal_id_fkey"
            columns: ["deal_id", "user_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "calendar_events_task_id_fkey"
            columns: ["task_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      call_time_stats: {
        Row: {
          attempts: number
          country_code: string
          created_at: string
          day_of_week: number
          hour: number
          id: string
          meetings: number
          updated_at: string
        }
        Insert: {
          attempts?: number
          country_code: string
          created_at?: string
          day_of_week: number
          hour: number
          id?: string
          meetings?: number
          updated_at?: string
        }
        Update: {
          attempts?: number
          country_code?: string
          created_at?: string
          day_of_week?: number
          hour?: number
          id?: string
          meetings?: number
          updated_at?: string
        }
        Relationships: []
      }
      contact_activities: {
        Row: {
          actor_id: string | null
          contact_id: string
          content: string | null
          created_at: string
          deal_id: string | null
          id: string
          occurred_at: string
          type: Database["public"]["Enums"]["contact_activity_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          contact_id: string
          content?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          occurred_at?: string
          type: Database["public"]["Enums"]["contact_activity_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          contact_id?: string
          content?: string | null
          created_at?: string
          deal_id?: string | null
          id?: string
          occurred_at?: string
          type?: Database["public"]["Enums"]["contact_activity_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_activities_contact_id_user_id_fkey"
            columns: ["contact_id", "user_id"]
            isOneToOne: false
            referencedRelation: "contact_list"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "contact_activities_contact_id_user_id_fkey"
            columns: ["contact_id", "user_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "contact_activities_deal_id_fkey"
            columns: ["deal_id", "user_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      contact_table_entries: {
        Row: {
          answers: Json
          contact_id: string
          created_at: string
          id: string
          moved_at: string
          table_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          answers?: Json
          contact_id: string
          created_at?: string
          id?: string
          moved_at?: string
          table_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          answers?: Json
          contact_id?: string
          created_at?: string
          id?: string
          moved_at?: string
          table_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_table_entries_contact_id_user_id_fkey"
            columns: ["contact_id", "user_id"]
            isOneToOne: false
            referencedRelation: "contact_list"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "contact_table_entries_contact_id_user_id_fkey"
            columns: ["contact_id", "user_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "contact_table_entries_table_id_user_id_fkey"
            columns: ["table_id", "user_id"]
            isOneToOne: false
            referencedRelation: "contact_tables"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      contact_table_fields: {
        Row: {
          created_at: string
          default_value: string | null
          depends_on_field_id: string | null
          depends_on_value: string | null
          id: string
          label: string
          options: Json | null
          position: number
          required: boolean
          system_key: string | null
          table_id: string
          type: Database["public"]["Enums"]["contact_field_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_value?: string | null
          depends_on_field_id?: string | null
          depends_on_value?: string | null
          id?: string
          label: string
          options?: Json | null
          position?: number
          required?: boolean
          system_key?: string | null
          table_id: string
          type: Database["public"]["Enums"]["contact_field_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_value?: string | null
          depends_on_field_id?: string | null
          depends_on_value?: string | null
          id?: string
          label?: string
          options?: Json | null
          position?: number
          required?: boolean
          system_key?: string | null
          table_id?: string
          type?: Database["public"]["Enums"]["contact_field_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_table_fields_depends_on_field_id_fkey"
            columns: ["depends_on_field_id", "user_id"]
            isOneToOne: false
            referencedRelation: "contact_table_fields"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "contact_table_fields_table_id_user_id_fkey"
            columns: ["table_id", "user_id"]
            isOneToOne: false
            referencedRelation: "contact_tables"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      contact_table_moves: {
        Row: {
          actor_id: string | null
          answers: Json
          contact_id: string
          created_at: string
          from_table_id: string | null
          id: string
          to_table_id: string | null
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          answers?: Json
          contact_id: string
          created_at?: string
          from_table_id?: string | null
          id?: string
          to_table_id?: string | null
          user_id: string
        }
        Update: {
          actor_id?: string | null
          answers?: Json
          contact_id?: string
          created_at?: string
          from_table_id?: string | null
          id?: string
          to_table_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_table_moves_contact_id_fkey"
            columns: ["contact_id", "user_id"]
            isOneToOne: false
            referencedRelation: "contact_list"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "contact_table_moves_contact_id_fkey"
            columns: ["contact_id", "user_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "contact_table_moves_from_table_id_fkey"
            columns: ["from_table_id", "user_id"]
            isOneToOne: false
            referencedRelation: "contact_tables"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "contact_table_moves_to_table_id_fkey"
            columns: ["to_table_id", "user_id"]
            isOneToOne: false
            referencedRelation: "contact_tables"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      contact_tables: {
        Row: {
          color: string
          created_at: string
          id: string
          is_system: boolean
          name: string
          position: number
          system_key: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_system?: boolean
          name: string
          position?: number
          system_key?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_system?: boolean
          name?: string
          position?: number
          system_key?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          address: string | null
          city: string | null
          company_name: string | null
          country_code: string | null
          created_at: string
          email: string | null
          external_place_id: string | null
          first_name: string | null
          generated_industry: string | null
          id: string
          last_name: string | null
          notes: string | null
          phone: string | null
          phone_normalized: string | null
          postal_code: string | null
          source: Database["public"]["Enums"]["contact_source"]
          tags: string[]
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          company_name?: string | null
          country_code?: string | null
          created_at?: string
          email?: string | null
          external_place_id?: string | null
          first_name?: string | null
          generated_industry?: string | null
          id?: string
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          phone_normalized?: string | null
          postal_code?: string | null
          source?: Database["public"]["Enums"]["contact_source"]
          tags?: string[]
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          company_name?: string | null
          country_code?: string | null
          created_at?: string
          email?: string | null
          external_place_id?: string | null
          first_name?: string | null
          generated_industry?: string | null
          id?: string
          last_name?: string | null
          notes?: string | null
          phone?: string | null
          phone_normalized?: string | null
          postal_code?: string | null
          source?: Database["public"]["Enums"]["contact_source"]
          tags?: string[]
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: []
      }
      deals: {
        Row: {
          contact_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          entered_stage_at: string
          expected_close_date: string | null
          id: string
          lost_at: string | null
          lost_reason: string | null
          position: number
          stage_id: string
          title: string
          updated_at: string
          user_id: string
          value: number | null
          won_at: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          entered_stage_at?: string
          expected_close_date?: string | null
          id?: string
          lost_at?: string | null
          lost_reason?: string | null
          position?: number
          stage_id: string
          title: string
          updated_at?: string
          user_id: string
          value?: number | null
          won_at?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          entered_stage_at?: string
          expected_close_date?: string | null
          id?: string
          lost_at?: string | null
          lost_reason?: string | null
          position?: number
          stage_id?: string
          title?: string
          updated_at?: string
          user_id?: string
          value?: number | null
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_contact_id_fkey"
            columns: ["contact_id", "user_id"]
            isOneToOne: false
            referencedRelation: "contact_list"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "deals_contact_id_fkey"
            columns: ["contact_id", "user_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "deals_stage_id_user_id_fkey"
            columns: ["stage_id", "user_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      fakturoid_connections: {
        Row: {
          account_slug: string
          connected_at: string
          created_at: string
          encrypted_credentials: string
          id: string
          last_sync_error: string | null
          last_synced_at: string | null
          move_deal_on_paid: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          account_slug: string
          connected_at?: string
          created_at?: string
          encrypted_credentials: string
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          move_deal_on_paid?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          account_slug?: string
          connected_at?: string
          created_at?: string
          encrypted_credentials?: string
          id?: string
          last_sync_error?: string | null
          last_synced_at?: string | null
          move_deal_on_paid?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      feature_requests: {
        Row: {
          admin_note: string | null
          created_at: string
          description: string | null
          id: string
          status: Database["public"]["Enums"]["feature_request_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          created_at?: string
          description?: string | null
          id?: string
          status?: Database["public"]["Enums"]["feature_request_status"]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          created_at?: string
          description?: string | null
          id?: string
          status?: Database["public"]["Enums"]["feature_request_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      generation_keyword_stats: {
        Row: {
          day: string
          keyword: string
          searches: number
        }
        Insert: {
          day: string
          keyword: string
          searches?: number
        }
        Update: {
          day?: string
          keyword?: string
          searches?: number
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount: number
          contact_id: string | null
          created_at: string
          currency: string
          customer_name: string | null
          deal_id: string | null
          due_on: string | null
          fakturoid_id: number | null
          id: string
          issued_on: string | null
          number: string
          paid_on: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          contact_id?: string | null
          created_at?: string
          currency?: string
          customer_name?: string | null
          deal_id?: string | null
          due_on?: string | null
          fakturoid_id?: number | null
          id?: string
          issued_on?: string | null
          number: string
          paid_on?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          contact_id?: string | null
          created_at?: string
          currency?: string
          customer_name?: string | null
          deal_id?: string | null
          due_on?: string | null
          fakturoid_id?: number | null
          id?: string
          issued_on?: string | null
          number?: string
          paid_on?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_contact_id_fkey"
            columns: ["contact_id", "user_id"]
            isOneToOne: false
            referencedRelation: "contact_list"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "invoices_contact_id_fkey"
            columns: ["contact_id", "user_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "invoices_deal_id_fkey"
            columns: ["deal_id", "user_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      jarvis_conversations: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          last_message_at: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      jarvis_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          model: string | null
          rating: string | null
          role: Database["public"]["Enums"]["jarvis_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          model?: string | null
          rating?: string | null
          role: Database["public"]["Enums"]["jarvis_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          model?: string | null
          rating?: string | null
          role?: Database["public"]["Enums"]["jarvis_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jarvis_messages_conversation_id_user_id_fkey"
            columns: ["conversation_id", "user_id"]
            isOneToOne: false
            referencedRelation: "jarvis_conversations"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      jarvis_suggestions: {
        Row: {
          action: Json
          answered_at: string | null
          created_at: string
          dedupe_key: string | null
          dismissed_at: string | null
          id: string
          kind: string
          payload: Json
          seen_at: string | null
          shown_at: string | null
          snoozed_until: string | null
          text: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action?: Json
          answered_at?: string | null
          created_at?: string
          dedupe_key?: string | null
          dismissed_at?: string | null
          id?: string
          kind?: string
          payload?: Json
          seen_at?: string | null
          shown_at?: string | null
          snoozed_until?: string | null
          text: string
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action?: Json
          answered_at?: string | null
          created_at?: string
          dedupe_key?: string | null
          dismissed_at?: string | null
          id?: string
          kind?: string
          payload?: Json
          seen_at?: string | null
          shown_at?: string | null
          snoozed_until?: string | null
          text?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      jarvis_watch_state: {
        Row: {
          created_at: string
          last_run_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          last_run_at: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          last_run_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      level_rewards: {
        Row: {
          level: number
          unlock_key: string
        }
        Insert: {
          level: number
          unlock_key: string
        }
        Update: {
          level?: number
          unlock_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "level_rewards_unlock_key_fkey"
            columns: ["unlock_key"]
            isOneToOne: false
            referencedRelation: "unlock_definitions"
            referencedColumns: ["key"]
          },
        ]
      }
      meeting_surveys: {
        Row: {
          answers: Json
          created_at: string
          deal_id: string
          id: string
          stage_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          answers?: Json
          created_at?: string
          deal_id: string
          id?: string
          stage_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          answers?: Json
          created_at?: string
          deal_id?: string
          id?: string
          stage_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_surveys_deal_id_user_id_fkey"
            columns: ["deal_id", "user_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "meeting_surveys_stage_id_fkey"
            columns: ["stage_id", "user_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      metrics_daily: {
        Row: {
          computed_at: string
          date: string
          metric_key: string
          segment: Json
          value: number
        }
        Insert: {
          computed_at?: string
          date: string
          metric_key: string
          segment?: Json
          value: number
        }
        Update: {
          computed_at?: string
          date?: string
          metric_key?: string
          segment?: Json
          value?: number
        }
        Relationships: []
      }
      milestones: {
        Row: {
          ai_feedback: string | null
          ai_feedback_at: string | null
          category: Database["public"]["Enums"]["milestone_category"]
          completed_at: string | null
          created_at: string
          description: string | null
          id: string
          position: number
          reward: string | null
          status: Database["public"]["Enums"]["milestone_status"]
          tag: string | null
          target_date: string | null
          template_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_feedback?: string | null
          ai_feedback_at?: string | null
          category?: Database["public"]["Enums"]["milestone_category"]
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          position?: number
          reward?: string | null
          status?: Database["public"]["Enums"]["milestone_status"]
          tag?: string | null
          target_date?: string | null
          template_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_feedback?: string | null
          ai_feedback_at?: string | null
          category?: Database["public"]["Enums"]["milestone_category"]
          completed_at?: string | null
          created_at?: string
          description?: string | null
          id?: string
          position?: number
          reward?: string | null
          status?: Database["public"]["Enums"]["milestone_status"]
          tag?: string | null
          target_date?: string | null
          template_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestones_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "path_milestones"
            referencedColumns: ["id"]
          },
        ]
      }
      nps_responses: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          score: number
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          score: number
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          score?: number
          user_id?: string
        }
        Relationships: []
      }
      path_milestones: {
        Row: {
          chapter: number
          created_at: string
          description: Json
          id: string
          key: string
          path_key: string
          position: number
          reward_hint: Json | null
          title: Json
          unlock_key: string | null
          xp: number
        }
        Insert: {
          chapter: number
          created_at?: string
          description: Json
          id?: string
          key: string
          path_key: string
          position: number
          reward_hint?: Json | null
          title: Json
          unlock_key?: string | null
          xp: number
        }
        Update: {
          chapter?: number
          created_at?: string
          description?: Json
          id?: string
          key?: string
          path_key?: string
          position?: number
          reward_hint?: Json | null
          title?: Json
          unlock_key?: string | null
          xp?: number
        }
        Relationships: [
          {
            foreignKeyName: "path_milestones_path_key_fkey"
            columns: ["path_key"]
            isOneToOne: false
            referencedRelation: "paths"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "path_milestones_unlock_key_fkey"
            columns: ["unlock_key"]
            isOneToOne: false
            referencedRelation: "unlock_definitions"
            referencedColumns: ["key"]
          },
        ]
      }
      path_tasks: {
        Row: {
          created_at: string
          description: Json | null
          id: string
          path_milestone_id: string
          position: number
          title: Json
        }
        Insert: {
          created_at?: string
          description?: Json | null
          id?: string
          path_milestone_id: string
          position: number
          title: Json
        }
        Update: {
          created_at?: string
          description?: Json | null
          id?: string
          path_milestone_id?: string
          position?: number
          title?: Json
        }
        Relationships: [
          {
            foreignKeyName: "path_tasks_path_milestone_id_fkey"
            columns: ["path_milestone_id"]
            isOneToOne: false
            referencedRelation: "path_milestones"
            referencedColumns: ["id"]
          },
        ]
      }
      paths: {
        Row: {
          created_at: string
          description: Json
          icon: string
          industries: string[]
          key: string
          name: Json
          position: number
        }
        Insert: {
          created_at?: string
          description: Json
          icon: string
          industries?: string[]
          key: string
          name: Json
          position?: number
        }
        Update: {
          created_at?: string
          description?: Json
          icon?: string
          industries?: string[]
          key?: string
          name?: Json
          position?: number
        }
        Relationships: []
      }
      pipeline_stages: {
        Row: {
          color: string
          created_at: string
          deposit_percent: number
          id: string
          is_lost: boolean
          is_won: boolean
          name: string
          position: number
          system_key: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          deposit_percent?: number
          id?: string
          is_lost?: boolean
          is_won?: boolean
          name: string
          position?: number
          system_key?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          deposit_percent?: number
          id?: string
          is_lost?: boolean
          is_won?: boolean
          name?: string
          position?: number
          system_key?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      plans: {
        Row: {
          ai_calls_limit: number
          created_at: string
          daily_generation_limit: number
          file_uploads_limit: number
          id: string
          is_default: boolean
          key: string
          monthly_generation_limit: number
          name: string
          updated_at: string
        }
        Insert: {
          ai_calls_limit: number
          created_at?: string
          daily_generation_limit: number
          file_uploads_limit: number
          id?: string
          is_default?: boolean
          key: string
          monthly_generation_limit: number
          name: string
          updated_at?: string
        }
        Update: {
          ai_calls_limit?: number
          created_at?: string
          daily_generation_limit?: number
          file_uploads_limit?: number
          id?: string
          is_default?: boolean
          key?: string
          monthly_generation_limit?: number
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          industry: string | null
          is_internal: boolean
          mode: string
          nps_asked_at: string | null
          onboarding_completed_at: string | null
          path_key: string | null
          seen_level: number
          tour_completed_at: string | null
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          industry?: string | null
          is_internal?: boolean
          mode?: string
          nps_asked_at?: string | null
          onboarding_completed_at?: string | null
          path_key?: string | null
          seen_level?: number
          tour_completed_at?: string | null
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          industry?: string | null
          is_internal?: boolean
          mode?: string
          nps_asked_at?: string | null
          onboarding_completed_at?: string | null
          path_key?: string | null
          seen_level?: number
          tour_completed_at?: string | null
          updated_at?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_path_key_fkey"
            columns: ["path_key"]
            isOneToOne: false
            referencedRelation: "paths"
            referencedColumns: ["key"]
          },
        ]
      }
      prospecting_segments: {
        Row: {
          actor_id: string | null
          created_at: string
          end_reason: Database["public"]["Enums"]["session_end_reason"] | null
          ended_at: string | null
          id: string
          started_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          end_reason?: Database["public"]["Enums"]["session_end_reason"] | null
          ended_at?: string | null
          id?: string
          started_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          end_reason?: Database["public"]["Enums"]["session_end_reason"] | null
          ended_at?: string | null
          id?: string
          started_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      recurring_payments: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          currency: string
          description: string
          due_day: number | null
          ends_on: string | null
          frequency: Database["public"]["Enums"]["recurring_frequency"]
          id: string
          is_active: boolean
          last_generated_on: string | null
          next_due_on: string
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string
          currency?: string
          description: string
          due_day?: number | null
          ends_on?: string | null
          frequency: Database["public"]["Enums"]["recurring_frequency"]
          id?: string
          is_active?: boolean
          last_generated_on?: string | null
          next_due_on: string
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          currency?: string
          description?: string
          due_day?: number | null
          ends_on?: string | null
          frequency?: Database["public"]["Enums"]["recurring_frequency"]
          id?: string
          is_active?: boolean
          last_generated_on?: string | null
          next_due_on?: string
          type?: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      reward_drafts: {
        Row: {
          created_at: string
          id: string
          owner_id: string
          tree: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id: string
          tree?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          tree?: Json
          updated_at?: string
        }
        Relationships: []
      }
      reward_rules: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          owner_id: string
          rules: Json
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          owner_id: string
          rules?: Json
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          owner_id?: string
          rules?: Json
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reward_rules_worker_id_owner_id_fkey"
            columns: ["worker_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      sales_analyses: {
        Row: {
          content: string
          created_at: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          current_period_start: string
          id: string
          plan_key: string
          status: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string
          id?: string
          plan_key: string
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string
          id?: string
          plan_key?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          trial_ends_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_key_fkey"
            columns: ["plan_key"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["key"]
          },
        ]
      }
      tasks: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          milestone_id: string
          parent_task_id: string | null
          position: number
          status: Database["public"]["Enums"]["task_status"]
          template_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          milestone_id: string
          parent_task_id?: string | null
          position?: number
          status?: Database["public"]["Enums"]["task_status"]
          template_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          milestone_id?: string
          parent_task_id?: string | null
          position?: number
          status?: Database["public"]["Enums"]["task_status"]
          template_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_milestone_id_user_id_fkey"
            columns: ["milestone_id", "user_id"]
            isOneToOne: false
            referencedRelation: "milestones"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "tasks_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "path_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          currency: string
          deal_id: string | null
          description: string | null
          id: string
          invoice_id: string | null
          needs_review: boolean
          occurred_on: string
          recurring_payment_id: string | null
          source: Database["public"]["Enums"]["transaction_source"]
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string
          currency?: string
          deal_id?: string | null
          description?: string | null
          id?: string
          invoice_id?: string | null
          needs_review?: boolean
          occurred_on: string
          recurring_payment_id?: string | null
          source?: Database["public"]["Enums"]["transaction_source"]
          type: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          currency?: string
          deal_id?: string | null
          description?: string | null
          id?: string
          invoice_id?: string | null
          needs_review?: boolean
          occurred_on?: string
          recurring_payment_id?: string | null
          source?: Database["public"]["Enums"]["transaction_source"]
          type?: Database["public"]["Enums"]["transaction_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_deal_id_fkey"
            columns: ["deal_id", "user_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "transactions_invoice_id_fkey"
            columns: ["invoice_id", "user_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "transactions_recurring_payment_id_fkey"
            columns: ["recurring_payment_id", "user_id"]
            isOneToOne: false
            referencedRelation: "recurring_payments"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      unlock_definitions: {
        Row: {
          created_at: string
          description: Json
          icon: string
          key: string
          kind: string
          name: Json
          position: number
        }
        Insert: {
          created_at?: string
          description: Json
          icon: string
          key: string
          kind: string
          name: Json
          position?: number
        }
        Update: {
          created_at?: string
          description?: Json
          icon?: string
          key?: string
          kind?: string
          name?: Json
          position?: number
        }
        Relationships: []
      }
      unlocks: {
        Row: {
          created_at: string
          id: string
          key: string
          seen_at: string | null
          unlocked_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          seen_at?: string | null
          unlocked_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          seen_at?: string | null
          unlocked_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      usage_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          message: string | null
          metadata: Json
          quantity: number
          success: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          message?: string | null
          metadata?: Json
          quantity?: number
          success?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          message?: string | null
          metadata?: Json
          quantity?: number
          success?: boolean
          user_id?: string
        }
        Relationships: []
      }
      user_achievements: {
        Row: {
          achievement_key: string
          earned_at: string
          user_id: string
        }
        Insert: {
          achievement_key: string
          earned_at?: string
          user_id: string
        }
        Update: {
          achievement_key?: string
          earned_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_achievement_key_fkey"
            columns: ["achievement_key"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["key"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          animations_enabled: boolean
          country_code: string
          created_at: string
          currency: string
          daily_call_goal: number
          date_format: string
          first_day_of_week: number
          id: string
          jarvis_frequency: string
          jarvis_proactive: boolean
          jarvis_quiet_from: number | null
          jarvis_quiet_to: number | null
          locale: string
          number_format: string
          recent_search_items: Json
          recent_searches: string[]
          reengage_after_months: number
          sound_enabled: boolean
          theme: string
          time_format: string
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          animations_enabled?: boolean
          country_code?: string
          created_at?: string
          currency?: string
          daily_call_goal?: number
          date_format?: string
          first_day_of_week?: number
          id?: string
          jarvis_frequency?: string
          jarvis_proactive?: boolean
          jarvis_quiet_from?: number | null
          jarvis_quiet_to?: number | null
          locale?: string
          number_format?: string
          recent_search_items?: Json
          recent_searches?: string[]
          reengage_after_months?: number
          sound_enabled?: boolean
          theme?: string
          time_format?: string
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          animations_enabled?: boolean
          country_code?: string
          created_at?: string
          currency?: string
          daily_call_goal?: number
          date_format?: string
          first_day_of_week?: number
          id?: string
          jarvis_frequency?: string
          jarvis_proactive?: boolean
          jarvis_quiet_from?: number | null
          jarvis_quiet_to?: number | null
          locale?: string
          number_format?: string
          recent_search_items?: Json
          recent_searches?: string[]
          reengage_after_months?: number
          sound_enabled?: boolean
          theme?: string
          time_format?: string
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      waitlist: {
        Row: {
          confirm_sent_at: string | null
          confirm_token_hash: string | null
          confirmed_at: string | null
          created_at: string
          email: string
          id: string
          locale: string
          source: string
        }
        Insert: {
          confirm_sent_at?: string | null
          confirm_token_hash?: string | null
          confirmed_at?: string | null
          created_at?: string
          email: string
          id?: string
          locale?: string
          source?: string
        }
        Update: {
          confirm_sent_at?: string | null
          confirm_token_hash?: string | null
          confirmed_at?: string | null
          created_at?: string
          email?: string
          id?: string
          locale?: string
          source?: string
        }
        Relationships: []
      }
      work_sessions: {
        Row: {
          created_at: string
          end_reason: Database["public"]["Enums"]["session_end_reason"] | null
          ended_at: string | null
          id: string
          note: string | null
          owner_id: string
          started_at: string
          updated_at: string
          worker_id: string
        }
        Insert: {
          created_at?: string
          end_reason?: Database["public"]["Enums"]["session_end_reason"] | null
          ended_at?: string | null
          id?: string
          note?: string | null
          owner_id: string
          started_at?: string
          updated_at?: string
          worker_id: string
        }
        Update: {
          created_at?: string
          end_reason?: Database["public"]["Enums"]["session_end_reason"] | null
          ended_at?: string | null
          id?: string
          note?: string | null
          owner_id?: string
          started_at?: string
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_sessions_worker_id_owner_id_fkey"
            columns: ["worker_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      worker_earnings: {
        Row: {
          amount: number
          approved_at: string | null
          basis: number | null
          created_at: string
          currency: string
          description: string | null
          id: string
          owner_id: string
          paid_at: string | null
          payment_id: string | null
          reward_rule_id: string | null
          source: Database["public"]["Enums"]["reward_trigger"] | null
          source_ref: string | null
          status: Database["public"]["Enums"]["earning_status"]
          updated_at: string
          work_session_id: string | null
          worker_id: string
          worker_task_id: string | null
        }
        Insert: {
          amount: number
          approved_at?: string | null
          basis?: number | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          owner_id: string
          paid_at?: string | null
          payment_id?: string | null
          reward_rule_id?: string | null
          source?: Database["public"]["Enums"]["reward_trigger"] | null
          source_ref?: string | null
          status?: Database["public"]["Enums"]["earning_status"]
          updated_at?: string
          work_session_id?: string | null
          worker_id: string
          worker_task_id?: string | null
        }
        Update: {
          amount?: number
          approved_at?: string | null
          basis?: number | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          owner_id?: string
          paid_at?: string | null
          payment_id?: string | null
          reward_rule_id?: string | null
          source?: Database["public"]["Enums"]["reward_trigger"] | null
          source_ref?: string | null
          status?: Database["public"]["Enums"]["earning_status"]
          updated_at?: string
          work_session_id?: string | null
          worker_id?: string
          worker_task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_earnings_payment_id_fkey"
            columns: ["payment_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "worker_payments"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "worker_earnings_reward_rule_id_fkey"
            columns: ["reward_rule_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "reward_rules"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "worker_earnings_work_session_id_fkey"
            columns: ["work_session_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "work_sessions"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "worker_earnings_worker_id_owner_id_fkey"
            columns: ["worker_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "worker_earnings_worker_task_id_fkey"
            columns: ["worker_task_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "worker_tasks"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      worker_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          code: string
          created_at: string
          email: string | null
          expires_at: string
          id: string
          owner_id: string
          updated_at: string
          worker_id: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          code?: string
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          owner_id: string
          updated_at?: string
          worker_id: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          code?: string
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          owner_id?: string
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_invites_worker_id_owner_id_fkey"
            columns: ["worker_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      worker_payments: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          note: string | null
          owner_id: string
          paid_at: string
          transaction_id: string | null
          updated_at: string
          worker_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          note?: string | null
          owner_id: string
          paid_at?: string
          transaction_id?: string | null
          updated_at?: string
          worker_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          note?: string | null
          owner_id?: string
          paid_at?: string
          transaction_id?: string | null
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_payments_transaction_id_fkey"
            columns: ["transaction_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "worker_payments_worker_id_owner_id_fkey"
            columns: ["worker_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      worker_permissions: {
        Row: {
          can_edit: boolean
          can_view: boolean
          created_at: string
          id: string
          owner_id: string
          section: Database["public"]["Enums"]["app_section"]
          updated_at: string
          worker_id: string
        }
        Insert: {
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          id?: string
          owner_id: string
          section: Database["public"]["Enums"]["app_section"]
          updated_at?: string
          worker_id: string
        }
        Update: {
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          id?: string
          owner_id?: string
          section?: Database["public"]["Enums"]["app_section"]
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_permissions_worker_id_owner_id_fkey"
            columns: ["worker_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      worker_tasks: {
        Row: {
          assigned_by: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          owner_id: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          worker_id: string
        }
        Insert: {
          assigned_by?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          owner_id: string
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
          worker_id: string
        }
        Update: {
          assigned_by?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          owner_id?: string
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_tasks_worker_id_owner_id_fkey"
            columns: ["worker_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "workers"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      workers: {
        Row: {
          created_at: string
          email: string | null
          id: string
          job_title: string | null
          name: string
          owner_id: string
          phone: string | null
          status: Database["public"]["Enums"]["worker_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          job_title?: string | null
          name: string
          owner_id: string
          phone?: string | null
          status?: Database["public"]["Enums"]["worker_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          job_title?: string | null
          name?: string
          owner_id?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["worker_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      xp_events: {
        Row: {
          created_at: string
          id: string
          idempotency_key: string
          kind: string
          metadata: Json
          user_id: string
          xp: number
        }
        Insert: {
          created_at?: string
          id?: string
          idempotency_key: string
          kind: string
          metadata?: Json
          user_id: string
          xp: number
        }
        Update: {
          created_at?: string
          id?: string
          idempotency_key?: string
          kind?: string
          metadata?: Json
          user_id?: string
          xp?: number
        }
        Relationships: []
      }
    }
    Views: {
      contact_list: {
        Row: {
          city: string | null
          company_name: string | null
          created_at: string | null
          email: string | null
          first_name: string | null
          id: string | null
          last_contact_at: string | null
          last_name: string | null
          phone: string | null
          phone_normalized: string | null
          search_name: string | null
          source: Database["public"]["Enums"]["contact_source"] | null
          table_id: string | null
          user_id: string | null
          website: string | null
        }
        Relationships: []
      }
      contact_table_counts: {
        Row: {
          contacts: number | null
          table_id: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_table_entries_table_id_user_id_fkey"
            columns: ["table_id", "user_id"]
            isOneToOne: false
            referencedRelation: "contact_tables"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      milestone_task_counts: {
        Row: {
          done: number | null
          milestone_id: string | null
          total: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_milestone_id_user_id_fkey"
            columns: ["milestone_id", "user_id"]
            isOneToOne: false
            referencedRelation: "milestones"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
    }
    Functions: {
      accept_worker_invite: {
        Args: { _code: string; _user_id: string }
        Returns: string
      }
      admin_session_end: { Args: never; Returns: undefined }
      admin_session_touch: { Args: { _activity?: boolean }; Returns: Json }
      analytics_take_quota: {
        Args: { _limit: number; _units: number; _user_id: string }
        Returns: number
      }
      app_overview: {
        Args: never
        Returns: {
          expired: number
          trialing: number
          waitlist: number
          waitlist_confirmed: number
        }[]
      }
      award_xp: { Args: { _reason: string; _ref_id?: string }; Returns: Json }
      book_invoice_income: {
        Args: {
          _invoice: Database["public"]["Tables"]["invoices"]["Row"]
          _paid_on: string
        }
        Returns: undefined
      }
      choose_path: { Args: { _path_key: string }; Returns: Json }
      count_generation_keyword: {
        Args: { _keyword: string }
        Returns: undefined
      }
      create_invoice_from_deal: {
        Args: { _deal_id: string }
        Returns: {
          amount: number
          contact_id: string | null
          created_at: string
          currency: string
          customer_name: string | null
          deal_id: string | null
          due_on: string | null
          fakturoid_id: number | null
          id: string
          issued_on: string | null
          number: string
          paid_on: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_plan: {
        Args: { _user_id: string }
        Returns: {
          ai_calls_limit: number
          daily_generation_limit: number
          file_uploads_limit: number
          monthly_generation_limit: number
          plan_key: string
          read_only: boolean
          status: string
          trial_ends_at: string
        }[]
      }
      current_workspace_id: { Args: never; Returns: string }
      evaluate_achievements: { Args: never; Returns: Json }
      fakturoid_apply_invoice: {
        Args: {
          _amount: number
          _due_on: string
          _fakturoid_id: number
          _move_deal: boolean
          _number: string
          _paid_on: string
          _status: Database["public"]["Enums"]["invoice_status"]
          _user_id: string
        }
        Returns: Json
      }
      finance_daily_totals: {
        Args: { _from: string; _to: string }
        Returns: {
          day: string
          expense: number
          income: number
        }[]
      }
      finance_monthly_totals: {
        Args: { _from: string; _to: string }
        Returns: {
          expense: number
          income: number
          month: string
        }[]
      }
      finance_totals: {
        Args: { _category?: string; _from: string; _to: string }
        Returns: {
          expense: number
          income: number
        }[]
      }
      game_daily_cap: { Args: { _kind: string }; Returns: number }
      game_evaluate_achievements: {
        Args: { _tz: string; _uid: string }
        Returns: Json
      }
      game_grant: {
        Args: {
          _cap_group?: string
          _day_start: string
          _key: string
          _kind: string
          _uid: string
          _xp: number
        }
        Returns: number
      }
      game_level_for_xp: { Args: { _xp: number }; Returns: number }
      game_level_threshold: { Args: { _level: number }; Returns: number }
      game_metrics: { Args: { _tz: string; _uid: string }; Returns: Json }
      game_state: { Args: never; Returns: Json }
      game_streak: {
        Args: { _tz: string; _uid: string }
        Returns: {
          freeze_available: boolean
          streak: number
        }[]
      }
      game_timezone: { Args: { _uid: string }; Returns: string }
      game_unlock_json: {
        Args: { _key: string; _level: number; _source: string }
        Returns: Json
      }
      global_search: {
        Args: {
          _amount?: number
          _kinds?: string[]
          _limit?: number
          _phone_patterns?: string[]
          _query: string
        }
        Returns: {
          data: Json
          id: string
          kind: string
          rank: number
          title: string
        }[]
      }
      grant_beta_plan: { Args: { _user_id: string }; Returns: undefined }
      grant_used_sections: { Args: { _uid: string }; Returns: undefined }
      grant_worker_rewards: {
        Args: {
          _basis: number
          _description: string
          _on_time: boolean
          _session_id: string
          _source_ref: string
          _task_id: string
          _trigger: Database["public"]["Enums"]["reward_trigger"]
          _worker_id: string
        }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_section_access: {
        Args: { _level: string; _owner: string; _section: string }
        Returns: boolean
      }
      import_generated_contacts: {
        Args: {
          _country?: string
          _industry?: string
          _limit: number
          _places: Json
        }
        Returns: {
          created: number
          duplicates: number
        }[]
      }
      industry_insights: { Args: never; Returns: Json }
      initialize_user: {
        Args: { _locale?: string; _user_id: string }
        Returns: undefined
      }
      is_client_request: { Args: never; Returns: boolean }
      is_internal_account: { Args: { _user_id: string }; Returns: boolean }
      jarvis_briefing_candidates: {
        Args: { _limit: number; _now: string }
        Returns: {
          user_id: string
        }[]
      }
      jarvis_watch_candidates: {
        Args: { _active_since: string; _limit: number }
        Returns: {
          last_run_at: string
          user_id: string
        }[]
      }
      jwt_totp_at: { Args: { _claims: Json }; Returns: string }
      mark_invoice_paid: {
        Args: { _invoice_id: string }
        Returns: {
          amount: number
          contact_id: string | null
          created_at: string
          currency: string
          customer_name: string | null
          deal_id: string | null
          due_on: string | null
          fakturoid_id: number | null
          id: string
          issued_on: string | null
          number: string
          paid_on: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "invoices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      meetings_daily: {
        Args: { _actor?: string; _from: string; _timezone: string; _to: string }
        Returns: {
          day: string
          meetings: number
        }[]
      }
      metric_activation: {
        Args: {
          _from: string
          _include_internal?: boolean
          _segment?: Json
          _to: string
          _tz?: string
        }
        Returns: {
          activated: number
          eligible: number
          pct: number
          signups: number
        }[]
      }
      metric_active_days: {
        Args: {
          _from: string
          _include_internal?: boolean
          _segment?: Json
          _to: string
          _tz?: string
        }
        Returns: {
          days: number
          user_weeks: number
        }[]
      }
      metric_active_events: { Args: never; Returns: string[] }
      metric_admin_user_detail: {
        Args: { _tz?: string; _user_id: string }
        Returns: Json
      }
      metric_admin_users: {
        Args: {
          _limit?: number
          _offset?: number
          _query?: string
          _sort?: string
          _tz?: string
        }
        Returns: {
          ai_cost_usd: number
          country: string
          industry: string
          is_internal: boolean
          last_active_at: string
          mode: string
          plan: string
          role: string
          signed_up_at: string
          status: string
          user_id: string
        }[]
      }
      metric_adoption: {
        Args: {
          _from: string
          _include_internal?: boolean
          _segment?: Json
          _to: string
          _tz?: string
        }
        Returns: {
          actions: number
          actions_per_user: number
          active_users: number
          pct: number
          section: string
          users: number
        }[]
      }
      metric_ai_top_users: {
        Args: {
          _from: string
          _include_internal?: boolean
          _limit?: number
          _segment?: Json
          _to: string
          _tz?: string
        }
        Returns: {
          calls: number
          cost_usd: number
          plan: string
          user_id: string
        }[]
      }
      metric_ai_usage: {
        Args: {
          _by?: string
          _from: string
          _include_internal?: boolean
          _segment?: Json
          _to: string
          _tz?: string
        }
        Returns: {
          cache_read_tokens: number
          cache_write_tokens: number
          calls: number
          cost_usd: number
          failed: number
          input_tokens: number
          key: string
          output_tokens: number
          p50_ms: number
          p95_ms: number
          users: number
        }[]
      }
      metric_call_time: {
        Args: {
          _from: string
          _include_internal?: boolean
          _segment?: Json
          _to: string
          _tz?: string
        }
        Returns: {
          callers: number
          hours: number
          hours_per_caller: number
          meetings: number
          meetings_per_hour: number
        }[]
      }
      metric_check_event: { Args: { _event: string }; Returns: undefined }
      metric_check_prop: { Args: { _prop: string }; Returns: undefined }
      metric_check_range: {
        Args: { _from: string; _to: string }
        Returns: undefined
      }
      metric_check_segment: { Args: { _segment: Json }; Returns: undefined }
      metric_cohorts: {
        Args: {
          _from: string
          _include_internal?: boolean
          _segment?: Json
          _to: string
          _tz?: string
          _weeks?: number
        }
        Returns: {
          active_users: number
          cohort_size: number
          cohort_week: string
          pct: number
          week: number
        }[]
      }
      metric_cost_inputs: {
        Args: {
          _from: string
          _include_internal?: boolean
          _segment?: Json
          _to: string
          _tz?: string
        }
        Returns: {
          active_users: number
          ai_calls: number
          ai_cost_usd: number
          emails_sent: number
          places_requests: number
          plan: string
          users: number
        }[]
      }
      metric_cron_runs: {
        Args: never
        Returns: {
          failures_7d: number
          job: string
          last_duration_ms: number
          last_ok: boolean
          last_run_at: string
          runs_7d: number
        }[]
      }
      metric_daily_keys: {
        Args: never
        Returns: {
          device: boolean
          metric_key: string
          segmentable: boolean
        }[]
      }
      metric_daily_value: {
        Args: {
          _day: string
          _device?: string
          _metric: string
          _tz: string
          _users: string[]
        }
        Returns: number
      }
      metric_day_start: { Args: { _day: string; _tz: string }; Returns: string }
      metric_distribution: {
        Args: {
          _include_internal?: boolean
          _kind: string
          _segment?: Json
          _tz?: string
        }
        Returns: {
          key: string
          users: number
          value: number
        }[]
      }
      metric_event_breakdown: {
        Args: {
          _by: string
          _calc: string
          _event: string
          _filter?: Json
          _from: string
          _include_internal?: boolean
          _limit?: number
          _prop?: string
          _segment?: Json
          _to: string
          _tz?: string
        }
        Returns: {
          key: string
          value: number
        }[]
      }
      metric_event_key: {
        Args: {
          _by: string
          _device: string
          _locale: string
          _mode: string
          _plan: string
          _props: Json
        }
        Returns: string
      }
      metric_event_number: {
        Args: {
          _created_at: string
          _prop: string
          _props: Json
          _user: string
        }
        Returns: number
      }
      metric_event_percentiles: {
        Args: {
          _by?: string
          _event: string
          _filter?: Json
          _from: string
          _include_internal?: boolean
          _prop: string
          _segment?: Json
          _to: string
          _tz?: string
        }
        Returns: {
          average: number
          key: string
          n: number
          p50: number
          p90: number
          p95: number
        }[]
      }
      metric_event_series: {
        Args: {
          _calc: string
          _event: string
          _filter?: Json
          _from: string
          _grain?: string
          _include_internal?: boolean
          _prop?: string
          _segment?: Json
          _to: string
          _tz?: string
        }
        Returns: {
          bucket: string
          value: number
        }[]
      }
      metric_funnel: {
        Args: {
          _from: string
          _include_internal?: boolean
          _segment?: Json
          _to: string
          _tz?: string
        }
        Returns: {
          median_hours_from_previous: number
          median_hours_from_start: number
          pct_of_previous: number
          pct_of_start: number
          step: number
          step_key: string
          users: number
        }[]
      }
      metric_generation_keywords: {
        Args: { _from: string; _limit?: number; _to: string }
        Returns: {
          keyword: string
          searches: number
        }[]
      }
      metric_jarvis_conversations: {
        Args: {
          _from: string
          _include_internal?: boolean
          _segment?: Json
          _to: string
          _tz?: string
        }
        Returns: {
          conversations: number
          median_messages_per_conversation: number
          messages_per_user: number
          user_messages: number
          users: number
        }[]
      }
      metric_money_by_currency: {
        Args: {
          _from: string
          _include_internal?: boolean
          _segment?: Json
          _to: string
          _tz?: string
        }
        Returns: {
          average: number
          currency: string
          items: number
          metric: string
          total: number
        }[]
      }
      metric_precomputed_segments: { Args: never; Returns: Json[] }
      metric_retention: {
        Args: {
          _from: string
          _include_internal?: boolean
          _segment?: Json
          _to: string
          _tz?: string
        }
        Returns: {
          day_n: number
          eligible: number
          pct: number
          retained: number
        }[]
      }
      metric_segment_has_user_keys: {
        Args: { _segment: Json }
        Returns: boolean
      }
      metric_segment_key: {
        Args: { _include_internal: boolean; _segment: Json }
        Returns: Json
      }
      metric_series: {
        Args: {
          _from: string
          _include_internal?: boolean
          _metrics: string[]
          _segment?: Json
          _to: string
          _tz?: string
        }
        Returns: {
          day: string
          metric_key: string
          value: number
        }[]
      }
      metric_sessions: {
        Args: {
          _from: string
          _include_internal?: boolean
          _segment?: Json
          _to: string
          _tz?: string
        }
        Returns: {
          median_minutes: number
          minutes_per_user_day: number
          p90_minutes: number
          sessions: number
          sessions_per_user_day: number
          sessions_per_user_week: number
          users: number
        }[]
      }
      metric_trials: {
        Args: { _include_internal?: boolean; _tz?: string }
        Returns: {
          converted: number
          ending_this_week: number
          expired: number
          running: number
        }[]
      }
      metric_usage_heatmap: {
        Args: {
          _from: string
          _include_internal?: boolean
          _segment?: Json
          _to: string
          _tz?: string
        }
        Returns: {
          events: number
          hour: number
          users: number
          weekday: number
        }[]
      }
      metric_user_dims: {
        Args: { _tz?: string }
        Returns: {
          country: string
          industry: string
          is_internal: boolean
          locale: string
          mode: string
          plan: string
          role: string
          signed_up_at: string
          signup_week: string
          user_id: string
        }[]
      }
      metric_users: {
        Args: { _include_internal?: boolean; _segment?: Json; _tz?: string }
        Returns: string[]
      }
      metric_waitlist: {
        Args: { _from: string; _to: string; _tz?: string }
        Returns: {
          confirm_rate: number
          confirmed: number
          converted: number
          joined: number
        }[]
      }
      metric_workers: {
        Args: {
          _from: string
          _include_internal?: boolean
          _to: string
          _tz?: string
        }
        Returns: {
          active_workers: number
          invites_accepted: number
          invites_expired: number
          invites_sent: number
          owners_with_workers: number
          workers: number
          workers_per_owner: number
        }[]
      }
      metrics_timezone: { Args: never; Returns: string }
      move_contact: {
        Args: { _answers?: Json; _contact_id: string; _to_table_id: string }
        Returns: {
          answers: Json
          contact_id: string
          created_at: string
          id: string
          moved_at: string
          table_id: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "contact_table_entries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      my_worker_ids: { Args: never; Returns: string[] }
      new_invite_code: { Args: never; Returns: string }
      normalize_phone: { Args: { _phone: string }; Returns: string }
      pause_prospecting: {
        Args: never
        Returns: {
          actor_id: string | null
          created_at: string
          end_reason: Database["public"]["Enums"]["session_end_reason"] | null
          ended_at: string | null
          id: string
          started_at: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "prospecting_segments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pause_work_session: {
        Args: { _worker_id: string }
        Returns: {
          created_at: string
          end_reason: Database["public"]["Enums"]["session_end_reason"] | null
          ended_at: string | null
          id: string
          note: string | null
          owner_id: string
          started_at: string
          updated_at: string
          worker_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      phone_calling_code: { Args: { _country: string }; Returns: string }
      phone_to_e164: {
        Args: { _country: string; _phone: string }
        Returns: string
      }
      post_due_recurring_payments: { Args: never; Returns: number }
      prospecting_daily_seconds: {
        Args: { _actor?: string; _from: string; _timezone: string; _to: string }
        Returns: {
          day: string
          seconds: number
        }[]
      }
      prospecting_effective_end: {
        Args: {
          _segment: Database["public"]["Tables"]["prospecting_segments"]["Row"]
        }
        Returns: string
      }
      prospecting_last_activity_at: {
        Args: {
          _segment: Database["public"]["Tables"]["prospecting_segments"]["Row"]
        }
        Returns: string
      }
      prospecting_record: {
        Args: { _timezone: string }
        Returns: {
          is_record: boolean
          previous_best: number
          seconds: number
        }[]
      }
      prospecting_seconds_for_day: {
        Args: { _day: string; _timezone: string }
        Returns: number
      }
      prospecting_status: {
        Args: { _timezone: string }
        Returns: {
          idle_closed_at: string
          idle_deadline: string
          running: boolean
          segment_started_at: string
          server_now: string
          today_seconds: number
        }[]
      }
      purge_analytics: {
        Args: { _before?: string }
        Returns: {
          events: number
          keywords: number
          sessions: number
          usage: number
        }[]
      }
      record_worker_payment: {
        Args: {
          _amount: number
          _note: string
          _paid_at: string
          _worker_id: string
        }
        Returns: {
          amount: number
          created_at: string
          currency: string
          id: string
          note: string | null
          owner_id: string
          paid_at: string
          transaction_id: string | null
          updated_at: string
          worker_id: string
        }
        SetofOptions: {
          from: "*"
          to: "worker_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      recurring_next_due: {
        Args: {
          _due_day?: number
          _frequency: Database["public"]["Enums"]["recurring_frequency"]
          _from: string
        }
        Returns: string
      }
      refresh_call_time_stats: { Args: never; Returns: number }
      refresh_metrics_daily: { Args: { _day: string }; Returns: number }
      remove_contact_table: {
        Args: { _move_to?: string; _table_id: string }
        Returns: undefined
      }
      remove_stage: {
        Args: { _move_to?: string; _stage_id: string }
        Returns: undefined
      }
      replace_reward_rules: { Args: { _rules: Json }; Returns: number }
      revoke_pending_rewards: {
        Args: {
          _source_ref: string
          _trigger: Database["public"]["Enums"]["reward_trigger"]
        }
        Returns: undefined
      }
      reward_rule_is_valid: { Args: { _rule: Json }; Returns: boolean }
      search_doc: { Args: { _parts: string[] }; Returns: string }
      search_matches: {
        Args: {
          _amount_digits: string
          _kind: string
          _limit: number
          _phones: string[]
          _q: string
        }
        Returns: {
          id: string
          rank: number
        }[]
      }
      search_norm: { Args: { _value: string }; Returns: string }
      search_rank: {
        Args: { _doc: string; _q: string; _title: string }
        Returns: number
      }
      set_deposit_stage: {
        Args: { _percent?: number; _stage_id: string }
        Returns: undefined
      }
      settle_idle_work_sessions: { Args: never; Returns: number }
      start_prospecting: {
        Args: never
        Returns: {
          actor_id: string | null
          created_at: string
          end_reason: Database["public"]["Enums"]["session_end_reason"] | null
          ended_at: string | null
          id: string
          started_at: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "prospecting_segments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      start_work_session: {
        Args: { _worker_id: string }
        Returns: {
          created_at: string
          end_reason: Database["public"]["Enums"]["session_end_reason"] | null
          ended_at: string | null
          id: string
          note: string | null
          owner_id: string
          started_at: string
          updated_at: string
          worker_id: string
        }
        SetofOptions: {
          from: "*"
          to: "work_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      theme_available: { Args: { _theme: string }; Returns: boolean }
      timer_idle_interval: { Args: never; Returns: string }
      touch_app_session: {
        Args: { _browser: string; _device: string; _user_id: string }
        Returns: string
      }
      user_today: { Args: { _user_id: string }; Returns: string }
      username_available: { Args: { _username: string }; Returns: boolean }
      work_seconds_between: {
        Args: { _from: string; _to: string; _worker_id: string }
        Returns: number
      }
      work_seconds_for_day: {
        Args: { _day: string; _timezone: string; _worker_id: string }
        Returns: number
      }
      work_session_effective_end: {
        Args: { _session: Database["public"]["Tables"]["work_sessions"]["Row"] }
        Returns: string
      }
      work_session_last_activity_at: {
        Args: { _session: Database["public"]["Tables"]["work_sessions"]["Row"] }
        Returns: string
      }
      work_status: {
        Args: { _timezone: string }
        Returns: {
          idle_closed_at: string
          idle_deadline: string
          month_seconds: number
          running: boolean
          server_now: string
          session_started_at: string
          today_seconds: number
          worker_id: string
        }[]
      }
      worker_balance: {
        Args: { _worker_id: string }
        Returns: {
          earned: number
          owed: number
          paid_out: number
          pending: number
        }[]
      }
      worker_month_stats: {
        Args: { _month_start: string; _timezone: string }
        Returns: {
          earned: number
          pending_amount: number
          pending_count: number
          tasks_done: number
          tasks_total: number
          work_seconds: number
          worker_id: string
        }[]
      }
      worker_sessions: {
        Args: { _before: string; _limit: number; _worker_id: string }
        Returns: {
          effective_end: string
          end_reason: Database["public"]["Enums"]["session_end_reason"]
          id: string
          running: boolean
          started_at: string
        }[]
      }
      workspace_read_only: { Args: { _owner: string }; Returns: boolean }
    }
    Enums: {
      admin_audit_kind: "login" | "view" | "export" | "update"
      app_role: "owner" | "admin" | "user"
      app_section:
        | "dashboard"
        | "milestones"
        | "pipeline"
        | "contacts"
        | "cold_calling"
        | "calendar"
        | "finance"
        | "workers"
        | "jarvis"
      calendar_event_kind:
        | "meeting"
        | "call"
        | "reminder"
        | "other"
        | "task"
        | "deadline"
      contact_activity_type:
        | "call"
        | "email"
        | "meeting"
        | "note"
        | "move"
        | "sms"
        | "email_sent"
      contact_field_type:
        | "text"
        | "long_text"
        | "date"
        | "datetime"
        | "select"
        | "boolean"
      contact_source: "manual" | "generated" | "import"
      earning_status: "pending" | "approved" | "paid"
      feature_request_status:
        | "new"
        | "planned"
        | "in_progress"
        | "done"
        | "declined"
      invoice_status:
        | "draft"
        | "open"
        | "sent"
        | "overdue"
        | "paid"
        | "cancelled"
        | "uncollectible"
      jarvis_role: "user" | "assistant"
      milestone_category: "work" | "personal"
      milestone_status: "active" | "completed" | "archived"
      recurring_frequency: "weekly" | "monthly" | "quarterly" | "yearly"
      reward_trigger:
        | "task_completed"
        | "meeting_booked"
        | "deal_won"
        | "hour_worked"
      session_end_reason: "pause" | "idle"
      subscription_status: "trialing" | "active" | "past_due" | "cancelled"
      task_status: "todo" | "in_progress" | "done"
      transaction_source:
        | "manual"
        | "recurring"
        | "deal_deposit"
        | "deal_invoice"
        | "invoice"
      transaction_type: "income" | "expense"
      worker_status: "invited" | "active" | "inactive"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      admin_audit_kind: ["login", "view", "export", "update"],
      app_role: ["owner", "admin", "user"],
      app_section: [
        "dashboard",
        "milestones",
        "pipeline",
        "contacts",
        "cold_calling",
        "calendar",
        "finance",
        "workers",
        "jarvis",
      ],
      calendar_event_kind: [
        "meeting",
        "call",
        "reminder",
        "other",
        "task",
        "deadline",
      ],
      contact_activity_type: [
        "call",
        "email",
        "meeting",
        "note",
        "move",
        "sms",
        "email_sent",
      ],
      contact_field_type: [
        "text",
        "long_text",
        "date",
        "datetime",
        "select",
        "boolean",
      ],
      contact_source: ["manual", "generated", "import"],
      earning_status: ["pending", "approved", "paid"],
      feature_request_status: [
        "new",
        "planned",
        "in_progress",
        "done",
        "declined",
      ],
      invoice_status: [
        "draft",
        "open",
        "sent",
        "overdue",
        "paid",
        "cancelled",
        "uncollectible",
      ],
      jarvis_role: ["user", "assistant"],
      milestone_category: ["work", "personal"],
      milestone_status: ["active", "completed", "archived"],
      recurring_frequency: ["weekly", "monthly", "quarterly", "yearly"],
      reward_trigger: [
        "task_completed",
        "meeting_booked",
        "deal_won",
        "hour_worked",
      ],
      session_end_reason: ["pause", "idle"],
      subscription_status: ["trialing", "active", "past_due", "cancelled"],
      task_status: ["todo", "in_progress", "done"],
      transaction_source: [
        "manual",
        "recurring",
        "deal_deposit",
        "deal_invoice",
        "invoice",
      ],
      transaction_type: ["income", "expense"],
      worker_status: ["invited", "active", "inactive"],
    },
  },
} as const
