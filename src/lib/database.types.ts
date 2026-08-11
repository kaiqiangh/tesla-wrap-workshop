export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      asset_cleanup_jobs: {
        Row: {
          bucket_id: string;
          completed_at: string | null;
          created_at: string;
          id: string;
          object_key: string;
          pending_upload_id: string;
          reason: string;
          state: string;
        };
        Insert: {
          bucket_id: string;
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          object_key: string;
          pending_upload_id: string;
          reason: string;
          state?: string;
        };
        Update: {
          bucket_id?: string;
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          object_key?: string;
          pending_upload_id?: string;
          reason?: string;
          state?: string;
        };
        Relationships: [
          {
            foreignKeyName: "asset_cleanup_jobs_pending_upload_id_fkey";
            columns: ["pending_upload_id"];
            isOneToOne: false;
            referencedRelation: "pending_uploads";
            referencedColumns: ["id"];
          },
        ];
      };
      asset_revisions: {
        Row: {
          byte_size: number;
          created_at: string;
          height_px: number;
          id: string;
          owner_id: string;
          ready_at: string;
          sha256: string;
          source_pending_upload_id: string;
          template_variant_id: string;
          template_verified: boolean;
          width_px: number;
        };
        Insert: {
          byte_size: number;
          created_at?: string;
          height_px: number;
          id: string;
          owner_id: string;
          ready_at?: string;
          sha256: string;
          source_pending_upload_id: string;
          template_variant_id: string;
          template_verified: boolean;
          width_px: number;
        };
        Update: {
          byte_size?: number;
          created_at?: string;
          height_px?: number;
          id?: string;
          owner_id?: string;
          ready_at?: string;
          sha256?: string;
          source_pending_upload_id?: string;
          template_variant_id?: string;
          template_verified?: boolean;
          width_px?: number;
        };
        Relationships: [
          {
            foreignKeyName: "asset_revisions_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "asset_revisions_source_pending_upload_id_fkey";
            columns: ["source_pending_upload_id"];
            isOneToOne: true;
            referencedRelation: "pending_uploads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "asset_revisions_template_variant_id_fkey";
            columns: ["template_variant_id"];
            isOneToOne: false;
            referencedRelation: "template_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      discovery_cursor_snapshots: {
        Row: {
          calculated_at: string;
          expires_at: string;
          payload: Json;
          token: string;
        };
        Insert: {
          calculated_at: string;
          expires_at: string;
          payload: Json;
          token: string;
        };
        Update: {
          calculated_at?: string;
          expires_at?: string;
          payload?: Json;
          token?: string;
        };
        Relationships: [];
      };
      discovery_engagement_events: {
        Row: {
          active: boolean;
          actor_id: string;
          id: string;
          kind: string;
          occurred_at: string;
          wrap_id: string;
        };
        Insert: {
          active?: boolean;
          actor_id: string;
          id?: string;
          kind: string;
          occurred_at?: string;
          wrap_id: string;
        };
        Update: {
          active?: boolean;
          actor_id?: string;
          id?: string;
          kind?: string;
          occurred_at?: string;
          wrap_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "discovery_engagement_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "discovery_engagement_events_wrap_id_fkey";
            columns: ["wrap_id"];
            isOneToOne: false;
            referencedRelation: "wraps";
            referencedColumns: ["id"];
          },
        ];
      };
      discovery_ranking_state: {
        Row: {
          calculated_at: string;
          id: boolean;
          status: string;
        };
        Insert: {
          calculated_at: string;
          id?: boolean;
          status: string;
        };
        Update: {
          calculated_at?: string;
          id?: boolean;
          status?: string;
        };
        Relationships: [];
      };
      download_events: {
        Row: {
          counted: boolean;
          granted_at: string;
          id: string;
          principal_hash: string;
          principal_kind: string;
          user_id: string | null;
          wrap_id: string;
        };
        Insert: {
          counted: boolean;
          granted_at?: string;
          id?: string;
          principal_hash: string;
          principal_kind: string;
          user_id?: string | null;
          wrap_id: string;
        };
        Update: {
          counted?: boolean;
          granted_at?: string;
          id?: string;
          principal_hash?: string;
          principal_kind?: string;
          user_id?: string | null;
          wrap_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "download_events_wrap_id_fkey";
            columns: ["wrap_id"];
            isOneToOne: false;
            referencedRelation: "wraps";
            referencedColumns: ["id"];
          },
        ];
      };
      pending_uploads: {
        Row: {
          asset_revision_id: string | null;
          created_at: string;
          declared_mime_type: string;
          expires_at: string;
          failure_code: string | null;
          failure_detail: Json | null;
          finalize_started_at: string | null;
          id: string;
          idempotency_key: string;
          original_filename: string;
          owner_id: string;
          staging_key: string;
          state: string;
          template_asserted: boolean;
          template_variant_id: string;
          updated_at: string;
        };
        Insert: {
          asset_revision_id?: string | null;
          created_at?: string;
          declared_mime_type: string;
          expires_at?: string;
          failure_code?: string | null;
          failure_detail?: Json | null;
          finalize_started_at?: string | null;
          id?: string;
          idempotency_key?: string;
          original_filename: string;
          owner_id: string;
          staging_key: string;
          state?: string;
          template_asserted: boolean;
          template_variant_id: string;
          updated_at?: string;
        };
        Update: {
          asset_revision_id?: string | null;
          created_at?: string;
          declared_mime_type?: string;
          expires_at?: string;
          failure_code?: string | null;
          failure_detail?: Json | null;
          finalize_started_at?: string | null;
          id?: string;
          idempotency_key?: string;
          original_filename?: string;
          owner_id?: string;
          staging_key?: string;
          state?: string;
          template_asserted?: boolean;
          template_variant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pending_upload_asset_revision_fkey";
            columns: ["asset_revision_id"];
            isOneToOne: true;
            referencedRelation: "asset_revisions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "pending_uploads_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "pending_uploads_template_variant_id_fkey";
            columns: ["template_variant_id"];
            isOneToOne: false;
            referencedRelation: "template_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          bio: string;
          created_at: string;
          display_name: string | null;
          onboarding_completed_at: string | null;
          participation_state: string;
          updated_at: string;
          user_id: string;
          username: string | null;
          username_changed_at: string | null;
        };
        Insert: {
          avatar_url?: string | null;
          bio?: string;
          created_at?: string;
          display_name?: string | null;
          onboarding_completed_at?: string | null;
          participation_state?: string;
          updated_at?: string;
          user_id: string;
          username?: string | null;
          username_changed_at?: string | null;
        };
        Update: {
          avatar_url?: string | null;
          bio?: string;
          created_at?: string;
          display_name?: string | null;
          onboarding_completed_at?: string | null;
          participation_state?: string;
          updated_at?: string;
          user_id?: string;
          username?: string | null;
          username_changed_at?: string | null;
        };
        Relationships: [];
      };
      tags: {
        Row: {
          created_at: string;
          display_name: string;
          id: string;
          slug: string;
        };
        Insert: {
          created_at?: string;
          display_name: string;
          id?: string;
          slug: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          id?: string;
          slug?: string;
        };
        Relationships: [];
      };
      template_variants: {
        Row: {
          active: boolean;
          allowed_mime_types: string[];
          catalog_key: string;
          display_name: string;
          height_px: number;
          id: string;
          max_file_bytes: number;
          source_commit: string;
          source_note: string;
          source_url: string;
          vehicle_model_id: string;
          verified_at: string;
          width_px: number;
        };
        Insert: {
          active?: boolean;
          allowed_mime_types?: string[];
          catalog_key: string;
          display_name: string;
          height_px: number;
          id: string;
          max_file_bytes?: number;
          source_commit: string;
          source_note: string;
          source_url: string;
          vehicle_model_id: string;
          verified_at: string;
          width_px: number;
        };
        Update: {
          active?: boolean;
          allowed_mime_types?: string[];
          catalog_key?: string;
          display_name?: string;
          height_px?: number;
          id?: string;
          max_file_bytes?: number;
          source_commit?: string;
          source_note?: string;
          source_url?: string;
          vehicle_model_id?: string;
          verified_at?: string;
          width_px?: number;
        };
        Relationships: [
          {
            foreignKeyName: "template_variants_vehicle_model_id_fkey";
            columns: ["vehicle_model_id"];
            isOneToOne: false;
            referencedRelation: "vehicle_models";
            referencedColumns: ["id"];
          },
        ];
      };
      vehicle_models: {
        Row: {
          active: boolean;
          display_name: string;
          id: string;
          slug: string;
          sort_order: number;
        };
        Insert: {
          active?: boolean;
          display_name: string;
          id: string;
          slug: string;
          sort_order: number;
        };
        Update: {
          active?: boolean;
          display_name?: string;
          id?: string;
          slug?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      wrap_assets: {
        Row: {
          asset_revision_id: string;
          bucket_id: string;
          byte_size: number;
          created_at: string;
          height_px: number;
          id: string;
          kind: string;
          object_key: string;
          sha256: string;
          width_px: number;
        };
        Insert: {
          asset_revision_id: string;
          bucket_id: string;
          byte_size: number;
          created_at?: string;
          height_px: number;
          id?: string;
          kind: string;
          object_key: string;
          sha256: string;
          width_px: number;
        };
        Update: {
          asset_revision_id?: string;
          bucket_id?: string;
          byte_size?: number;
          created_at?: string;
          height_px?: number;
          id?: string;
          kind?: string;
          object_key?: string;
          sha256?: string;
          width_px?: number;
        };
        Relationships: [
          {
            foreignKeyName: "wrap_assets_asset_revision_id_fkey";
            columns: ["asset_revision_id"];
            isOneToOne: false;
            referencedRelation: "asset_revisions";
            referencedColumns: ["id"];
          },
        ];
      };
      wrap_tags: {
        Row: {
          created_at: string;
          tag_id: string;
          wrap_id: string;
        };
        Insert: {
          created_at?: string;
          tag_id: string;
          wrap_id: string;
        };
        Update: {
          created_at?: string;
          tag_id?: string;
          wrap_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wrap_tags_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "tags";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wrap_tags_wrap_id_fkey";
            columns: ["wrap_id"];
            isOneToOne: false;
            referencedRelation: "wraps";
            referencedColumns: ["id"];
          },
        ];
      };
      wraps: {
        Row: {
          asset_revision_id: string;
          comment_count: number;
          created_at: string;
          creator_id: string;
          deleted_at: string | null;
          description: string;
          distribution_asserted: boolean;
          download_count: number;
          favorite_count: number;
          first_published_at: string | null;
          id: string;
          license_type: string;
          like_count: number;
          slug: string;
          status: string;
          template_asserted: boolean;
          template_variant_id: string;
          title: string;
          updated_at: string;
          vehicle_model_id: string;
        };
        Insert: {
          asset_revision_id: string;
          comment_count?: number;
          created_at?: string;
          creator_id: string;
          deleted_at?: string | null;
          description: string;
          distribution_asserted: boolean;
          download_count?: number;
          favorite_count?: number;
          first_published_at?: string | null;
          id?: string;
          license_type: string;
          like_count?: number;
          slug: string;
          status?: string;
          template_asserted: boolean;
          template_variant_id: string;
          title: string;
          updated_at?: string;
          vehicle_model_id: string;
        };
        Update: {
          asset_revision_id?: string;
          comment_count?: number;
          created_at?: string;
          creator_id?: string;
          deleted_at?: string | null;
          description?: string;
          distribution_asserted?: boolean;
          download_count?: number;
          favorite_count?: number;
          first_published_at?: string | null;
          id?: string;
          license_type?: string;
          like_count?: number;
          slug?: string;
          status?: string;
          template_asserted?: boolean;
          template_variant_id?: string;
          title?: string;
          updated_at?: string;
          vehicle_model_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wraps_asset_revision_id_fkey";
            columns: ["asset_revision_id"];
            isOneToOne: true;
            referencedRelation: "asset_revisions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wraps_creator_id_fkey";
            columns: ["creator_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "wraps_template_variant_id_fkey";
            columns: ["template_variant_id"];
            isOneToOne: false;
            referencedRelation: "template_variants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wraps_vehicle_model_id_fkey";
            columns: ["vehicle_model_id"];
            isOneToOne: false;
            referencedRelation: "vehicle_models";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      claim_pending_upload: {
        Args: { p_id: string; p_owner: string };
        Returns: {
          asset_revision_id: string;
          claimed: boolean;
          state: string;
        }[];
      };
      complete_pending_upload: {
        Args: {
          p_height: number;
          p_id: string;
          p_original_bytes: number;
          p_original_sha256: string;
          p_preview_bytes: number;
          p_preview_height: number;
          p_preview_sha256: string;
          p_preview_width: number;
          p_revision_id: string;
          p_thumbnail_bytes: number;
          p_thumbnail_height: number;
          p_thumbnail_sha256: string;
          p_thumbnail_width: number;
          p_width: number;
        };
        Returns: string;
      };
      complete_profile: {
        Args: { p_display_name: string; p_username: string };
        Returns: {
          username: string;
        }[];
      };
      current_profile_access: {
        Args: never;
        Returns: {
          may_onboard: boolean;
          may_participate: boolean;
          username: string;
        }[];
      };
      edit_wrap: {
        Args: {
          p_creator_id: string;
          p_description: string;
          p_license_type: string;
          p_slug: string;
          p_tags: string[];
          p_title: string;
        };
        Returns: {
          first_published_at: string;
          id: string;
          slug: string;
          status: string;
        }[];
      };
      fail_pending_upload: {
        Args: { p_code: string; p_detail: Json; p_id: string };
        Returns: undefined;
      };
      get_discovery_wraps: {
        Args: { p_kind: string; p_limit?: number; p_model_slug?: string };
        Returns: {
          availability_caveat: string;
          comment_count: number;
          creator_display_name: string;
          creator_username: string;
          description: string;
          download_count: number;
          favorite_count: number;
          first_published_at: string;
          height_px: number;
          id: string;
          legacy: boolean;
          license_type: string;
          like_count: number;
          preview_available: boolean;
          preview_height_px: number;
          preview_width_px: number;
          slug: string;
          tags: string[];
          template_variant_key: string;
          template_variant_name: string;
          title: string;
          vehicle_model_name: string;
          vehicle_model_slug: string;
          verified_at: string;
          width_px: number;
        }[];
      };
      get_owner_wrap: {
        Args: { p_creator_id: string; p_slug: string };
        Returns: {
          asset_revision_id: string;
          creator_username: string;
          description: string;
          distribution_asserted: boolean;
          first_published_at: string;
          height_px: number;
          id: string;
          license_type: string;
          slug: string;
          status: string;
          tags: string[];
          template_asserted: boolean;
          template_variant_key: string;
          template_variant_name: string;
          title: string;
          verified_at: string;
          width_px: number;
        }[];
      };
      get_pending_upload: {
        Args: { p_id: string };
        Returns: {
          asset_revision_id: string;
          declared_mime_type: string;
          expires_at: string;
          failure_code: string;
          failure_detail: Json;
          height_px: number;
          id: string;
          max_file_bytes: number;
          original_filename: string;
          owner_id: string;
          staging_key: string;
          state: string;
          template_asserted: boolean;
          template_variant_id: string;
          width_px: number;
        }[];
      };
      get_public_creator_wraps: {
        Args: { p_username: string };
        Returns: {
          availability_caveat: string;
          comment_count: number;
          creator_display_name: string;
          creator_username: string;
          description: string;
          download_count: number;
          favorite_count: number;
          first_published_at: string;
          height_px: number;
          id: string;
          legacy: boolean;
          license_type: string;
          like_count: number;
          preview_available: boolean;
          preview_height_px: number;
          preview_width_px: number;
          slug: string;
          tags: string[];
          template_variant_key: string;
          template_variant_name: string;
          title: string;
          vehicle_model_name: string;
          verified_at: string;
          width_px: number;
        }[];
      };
      get_public_profile: {
        Args: { p_username: string };
        Returns: {
          avatar_url: string;
          bio: string;
          display_name: string;
          username: string;
        }[];
      };
      get_public_vehicle_model: {
        Args: { p_slug: string };
        Returns: {
          display_name: string;
          slug: string;
          sort_order: number;
        }[];
      };
      get_public_wrap: {
        Args: { p_slug: string };
        Returns: {
          availability_caveat: string;
          comment_count: number;
          creator_display_name: string;
          creator_username: string;
          description: string;
          download_count: number;
          favorite_count: number;
          first_published_at: string;
          height_px: number;
          id: string;
          legacy: boolean;
          license_type: string;
          like_count: number;
          preview_available: boolean;
          preview_height_px: number;
          preview_width_px: number;
          slug: string;
          tags: string[];
          template_variant_key: string;
          template_variant_name: string;
          title: string;
          vehicle_model_name: string;
          verified_at: string;
          width_px: number;
        }[];
      };
      get_public_wrap_media: {
        Args: { p_slug: string };
        Returns: {
          byte_size: number;
          object_key: string;
          sha256: string;
        }[];
      };
      prepare_original_download: {
        Args: { p_slug: string; p_user_id: string };
        Returns: {
          availability_caveat: string;
          bucket_id: string;
          byte_size: number;
          height_px: number;
          object_key: string;
          sha256: string;
          template_variant_key: string;
          template_variant_name: string;
          title: string;
          vehicle_model_name: string;
          verified_at: string;
          width_px: number;
          wrap_id: string;
        }[];
      };
      publish_wrap: {
        Args: {
          p_asset_revision_id: string;
          p_creator_id: string;
          p_description: string;
          p_distribution_asserted: boolean;
          p_license_type: string;
          p_tags: string[];
          p_template_asserted: boolean;
          p_template_variant_id: string;
          p_title: string;
        };
        Returns: {
          asset_revision_id: string;
          created: boolean;
          first_published_at: string;
          id: string;
          slug: string;
          status: string;
          template_variant_id: string;
        }[];
      };
      record_discovery_engagement_event: {
        Args: {
          p_actor_id: string;
          p_kind: string;
          p_occurred_at?: string;
          p_wrap_id: string;
        };
        Returns: string;
      };
      reconcile_download_counts: { Args: never; Returns: undefined };
      refresh_discovery_ranking: { Args: never; Returns: string };
      record_original_download: {
        Args: {
          p_guest_principal_hash: string;
          p_user_id: string;
          p_wrap_id: string;
        };
        Returns: {
          counted: boolean;
          download_count: number;
          event_id: string;
        }[];
      };
      remove_wrap: {
        Args: { p_creator_id: string; p_slug: string };
        Returns: {
          first_published_at: string;
          id: string;
          slug: string;
          status: string;
        }[];
      };
      republish_wrap: {
        Args: { p_creator_id: string; p_slug: string };
        Returns: {
          first_published_at: string;
          id: string;
          slug: string;
          status: string;
        }[];
      };
      search_discovery_wraps: {
        Args: {
          p_cursor?: string;
          p_limit?: number;
          p_model_slug?: string;
          p_q?: string;
          p_sort?: string;
          p_variant_key?: string;
        };
        Returns: Json;
      };
      start_pending_upload: {
        Args: {
          p_declared_mime_type: string;
          p_original_filename: string;
          p_template_asserted: boolean;
          p_template_variant_id: string;
        };
        Returns: {
          expires_at: string;
          id: string;
          idempotency_key: string;
          staging_key: string;
        }[];
      };
      unpublish_wrap: {
        Args: { p_creator_id: string; p_slug: string };
        Returns: {
          first_published_at: string;
          id: string;
          slug: string;
          status: string;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
