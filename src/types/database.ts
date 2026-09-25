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
      ai_usage: {
        Row: {
          cache_read_tokens: number
          cache_write_tokens: number
          conversation_id: string | null
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
      attachments: {
        Row: {
          created_at: string
          entity_id: string
          entity_type: string
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
          all_day: boolean
          contact_id: string | null
          created_at: string
          deal_id: string | null
          description: string | null
          ends_at: string | null
          id: string
          kind: Database["public"]["Enums"]["calendar_event_kind"]
          location: string | null
          starts_at: string
          task_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          all_day?: boolean
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["calendar_event_kind"]
          location?: string | null
          starts_at: string
          task_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          all_day?: boolean
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          description?: string | null
          ends_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["calendar_event_kind"]
          location?: string | null
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
          answers: Json
          contact_id: string
          created_at: string
          from_table_id: string | null
          id: string
          to_table_id: string | null
          user_id: string
        }
        Insert: {
          answers?: Json
          contact_id: string
          created_at?: string
          from_table_id?: string | null
          id?: string
          to_table_id?: string | null
          user_id: string
        }
        Update: {
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
          last_synced_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_slug: string
          connected_at?: string
          created_at?: string
          encrypted_credentials: string
          id?: string
          last_synced_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_slug?: string
          connected_at?: string
          created_at?: string
          encrypted_credentials?: string
          id?: string
          last_synced_at?: string | null
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
          status: Database["public"]["Enums"]["milestone_status"]
          tag: string | null
          target_date: string | null
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
          status?: Database["public"]["Enums"]["milestone_status"]
          tag?: string | null
          target_date?: string | null
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
          status?: Database["public"]["Enums"]["milestone_status"]
          tag?: string | null
          target_date?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pipeline_stages: {
        Row: {
          color: string
          created_at: string
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
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      prospecting_segments: {
        Row: {
          created_at: string
          end_reason: Database["public"]["Enums"]["session_end_reason"] | null
          ended_at: string | null
          id: string
          started_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          end_reason?: Database["public"]["Enums"]["session_end_reason"] | null
          ended_at?: string | null
          id?: string
          started_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
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
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          milestone_id: string
          parent_task_id: string | null
          position: number
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          milestone_id: string
          parent_task_id?: string | null
          position?: number
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          milestone_id?: string
          parent_task_id?: string | null
          position?: number
          status?: Database["public"]["Enums"]["task_status"]
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
          occurred_on: string
          recurring_payment_id: string | null
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
          occurred_on: string
          recurring_payment_id?: string | null
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
          occurred_on?: string
          recurring_payment_id?: string | null
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
          country_code: string
          created_at: string
          currency: string
          daily_call_goal: number
          date_format: string
          first_day_of_week: number
          id: string
          locale: string
          number_format: string
          sound_enabled: boolean
          time_format: string
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          country_code?: string
          created_at?: string
          currency?: string
          daily_call_goal?: number
          date_format?: string
          first_day_of_week?: number
          id?: string
          locale?: string
          number_format?: string
          sound_enabled?: boolean
          time_format?: string
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          country_code?: string
          created_at?: string
          currency?: string
          daily_call_goal?: number
          date_format?: string
          first_day_of_week?: number
          id?: string
          locale?: string
          number_format?: string
          sound_enabled?: boolean
          time_format?: string
          timezone?: string
          updated_at?: string
          user_id?: string
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
          created_at: string
          currency: string
          description: string | null
          id: string
          owner_id: string
          paid_at: string | null
          payment_id: string | null
          reward_rule_id: string | null
          status: Database["public"]["Enums"]["earning_status"]
          updated_at: string
          work_session_id: string | null
          worker_id: string
          worker_task_id: string | null
        }
        Insert: {
          amount: number
          approved_at?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          owner_id: string
          paid_at?: string | null
          payment_id?: string | null
          reward_rule_id?: string | null
          status?: Database["public"]["Enums"]["earning_status"]
          updated_at?: string
          work_session_id?: string | null
          worker_id: string
          worker_task_id?: string | null
        }
        Update: {
          amount?: number
          approved_at?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          owner_id?: string
          paid_at?: string | null
          payment_id?: string | null
          reward_rule_id?: string | null
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
          name?: string
          owner_id?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["worker_status"]
          updated_at?: string
          user_id?: string | null
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
          website: string | null
        }
        Relationships: []
      }
      contact_table_counts: {
        Row: {
          contacts: number | null
          table_id: string | null
        }
        Relationships: []
      }
      milestone_task_counts: {
        Row: {
          done: number | null
          milestone_id: string | null
          total: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_generated_contacts: {
        Args: { _country?: string; _limit: number; _places: Json }
        Returns: {
          created: number
          duplicates: number
        }[]
      }
      initialize_user: {
        Args: { _locale?: string; _user_id: string }
        Returns: undefined
      }
      is_client_request: { Args: never; Returns: boolean }
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
      normalize_phone: { Args: { _phone: string }; Returns: string }
      pause_prospecting: {
        Args: never
        Returns: {
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
      prospecting_seconds_for_day: {
        Args: { _day: string; _timezone: string }
        Returns: number
      }
      remove_contact_table: {
        Args: { _move_to?: string; _table_id: string }
        Returns: undefined
      }
      remove_stage: {
        Args: { _move_to?: string; _stage_id: string }
        Returns: undefined
      }
      start_prospecting: {
        Args: never
        Returns: {
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
      timer_idle_interval: { Args: never; Returns: string }
      username_available: { Args: { _username: string }; Returns: boolean }
      work_seconds_for_day: {
        Args: { _day: string; _timezone: string; _worker_id: string }
        Returns: number
      }
      work_session_effective_end: {
        Args: { _session: Database["public"]["Tables"]["work_sessions"]["Row"] }
        Returns: string
      }
    }
    Enums: {
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
      calendar_event_kind: "meeting" | "call" | "reminder" | "other"
      contact_activity_type:
        | "call"
        | "email"
        | "meeting"
        | "note"
        | "move"
        | "sms"
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
      session_end_reason: "pause" | "idle"
      subscription_status: "trialing" | "active" | "past_due" | "cancelled"
      task_status: "todo" | "in_progress" | "done"
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
      calendar_event_kind: ["meeting", "call", "reminder", "other"],
      contact_activity_type: [
        "call",
        "email",
        "meeting",
        "note",
        "move",
        "sms",
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
      session_end_reason: ["pause", "idle"],
      subscription_status: ["trialing", "active", "past_due", "cancelled"],
      task_status: ["todo", "in_progress", "done"],
      transaction_type: ["income", "expense"],
      worker_status: ["invited", "active", "inactive"],
    },
  },
} as const
