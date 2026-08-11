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
          attempts: number;
          available_after: string;
          bucket_id: string;
          claimed_at: string | null;
          completed_at: string | null;
          created_at: string;
          id: string;
          last_error: string | null;
          object_key: string;
          pending_upload_id: string;
          reason: string;
          state: string;
        };
        Insert: {
          attempts?: number;
          available_after?: string;
          bucket_id: string;
          claimed_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          last_error?: string | null;
          object_key: string;
          pending_upload_id: string;
          reason: string;
          state?: string;
        };
        Update: {
          attempts?: number;
          available_after?: string;
          bucket_id?: string;
          claimed_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          last_error?: string | null;
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
      creator_follows: {
        Row: {
          created_at: string;
          creator_id: string;
          follower_id: string;
        };
        Insert: {
          created_at?: string;
          creator_id: string;
          follower_id: string;
        };
        Update: {
          created_at?: string;
          creator_id?: string;
          follower_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "creator_follows_creator_id_fkey";
            columns: ["creator_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "creator_follows_follower_id_fkey";
            columns: ["follower_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
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
          source_id: string | null;
          wrap_id: string;
        };
        Insert: {
          active?: boolean;
          actor_id: string;
          id?: string;
          kind: string;
          occurred_at?: string;
          source_id?: string | null;
          wrap_id: string;
        };
        Update: {
          active?: boolean;
          actor_id?: string;
          id?: string;
          kind?: string;
          occurred_at?: string;
          source_id?: string | null;
          wrap_id?: string;
        };
        Relationships: [
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
      moderation_actions: {
        Row: {
          action_kind: string;
          actor_id: string;
          created_at: string;
          id: string;
          idempotency_key: string;
          new_state: string;
          previous_state: string;
          private_note: string | null;
          reason: string;
          report_id: string | null;
          target_id: string;
          target_kind: string;
        };
        Insert: {
          action_kind: string;
          actor_id: string;
          created_at?: string;
          id?: string;
          idempotency_key: string;
          new_state: string;
          previous_state: string;
          private_note?: string | null;
          reason: string;
          report_id?: string | null;
          target_id: string;
          target_kind: string;
        };
        Update: {
          action_kind?: string;
          actor_id?: string;
          created_at?: string;
          id?: string;
          idempotency_key?: string;
          new_state?: string;
          previous_state?: string;
          private_note?: string | null;
          reason?: string;
          report_id?: string | null;
          target_id?: string;
          target_kind?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moderation_actions_report_id_fkey";
            columns: ["report_id"];
            isOneToOne: false;
            referencedRelation: "reports";
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
      profile_avatar_assets: {
        Row: {
          byte_size: number;
          created_at: string;
          derived_bucket: string;
          derived_key: string;
          height_px: number;
          id: string;
          profile_id: string;
          retired_at: string | null;
          sha256: string;
          source_bucket: string;
          source_key: string;
          state: string;
          width_px: number;
        };
        Insert: {
          byte_size: number;
          created_at?: string;
          derived_bucket?: string;
          derived_key: string;
          height_px: number;
          id?: string;
          profile_id: string;
          retired_at?: string | null;
          sha256: string;
          source_bucket?: string;
          source_key: string;
          state?: string;
          width_px: number;
        };
        Update: {
          byte_size?: number;
          created_at?: string;
          derived_bucket?: string;
          derived_key?: string;
          height_px?: number;
          id?: string;
          profile_id?: string;
          retired_at?: string | null;
          sha256?: string;
          source_bucket?: string;
          source_key?: string;
          state?: string;
          width_px?: number;
        };
        Relationships: [
          {
            foreignKeyName: "profile_avatar_assets_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      profile_cleanup_jobs: {
        Row: {
          attempts: number;
          available_after: string;
          avatar_asset_id: string | null;
          bucket_id: string;
          claimed_at: string | null;
          completed_at: string | null;
          created_at: string;
          id: string;
          last_error: string | null;
          object_key: string;
          profile_id: string;
          state: string;
        };
        Insert: {
          attempts?: number;
          available_after?: string;
          avatar_asset_id?: string | null;
          bucket_id: string;
          claimed_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          last_error?: string | null;
          object_key: string;
          profile_id: string;
          state?: string;
        };
        Update: {
          attempts?: number;
          available_after?: string;
          avatar_asset_id?: string | null;
          bucket_id?: string;
          claimed_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          last_error?: string | null;
          object_key?: string;
          profile_id?: string;
          state?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profile_cleanup_jobs_avatar_asset_id_fkey";
            columns: ["avatar_asset_id"];
            isOneToOne: false;
            referencedRelation: "profile_avatar_assets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profile_cleanup_jobs_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      profile_username_aliases: {
        Row: {
          alias: string;
          created_at: string;
          profile_id: string;
        };
        Insert: {
          alias: string;
          created_at?: string;
          profile_id: string;
        };
        Update: {
          alias?: string;
          created_at?: string;
          profile_id?: string;
        };
        Relationships: [];
      };
      profile_wrap_cleanup_jobs: {
        Row: {
          asset_revision_id: string;
          attempts: number;
          available_after: string;
          bucket_id: string;
          claimed_at: string | null;
          completed_at: string | null;
          created_at: string;
          id: string;
          last_error: string | null;
          object_key: string;
          profile_id: string;
          state: string;
        };
        Insert: {
          asset_revision_id: string;
          attempts?: number;
          available_after: string;
          bucket_id: string;
          claimed_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          last_error?: string | null;
          object_key: string;
          profile_id: string;
          state?: string;
        };
        Update: {
          asset_revision_id?: string;
          attempts?: number;
          available_after?: string;
          bucket_id?: string;
          claimed_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          id?: string;
          last_error?: string | null;
          object_key?: string;
          profile_id?: string;
          state?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profile_wrap_cleanup_jobs_asset_revision_id_fkey";
            columns: ["asset_revision_id"];
            isOneToOne: false;
            referencedRelation: "asset_revisions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profile_wrap_cleanup_jobs_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      profiles: {
        Row: {
          anonymized_at: string | null;
          avatar_asset_id: string | null;
          avatar_url: string | null;
          bio: string;
          created_at: string;
          deactivated_at: string | null;
          display_name: string | null;
          onboarding_completed_at: string | null;
          participation_state: string;
          recovery_until: string | null;
          updated_at: string;
          user_id: string;
          username: string | null;
          username_changed_at: string | null;
        };
        Insert: {
          anonymized_at?: string | null;
          avatar_asset_id?: string | null;
          avatar_url?: string | null;
          bio?: string;
          created_at?: string;
          deactivated_at?: string | null;
          display_name?: string | null;
          onboarding_completed_at?: string | null;
          participation_state?: string;
          recovery_until?: string | null;
          updated_at?: string;
          user_id: string;
          username?: string | null;
          username_changed_at?: string | null;
        };
        Update: {
          anonymized_at?: string | null;
          avatar_asset_id?: string | null;
          avatar_url?: string | null;
          bio?: string;
          created_at?: string;
          deactivated_at?: string | null;
          display_name?: string | null;
          onboarding_completed_at?: string | null;
          participation_state?: string;
          recovery_until?: string | null;
          updated_at?: string;
          user_id?: string;
          username?: string | null;
          username_changed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_avatar_asset_id_fkey";
            columns: ["avatar_asset_id"];
            isOneToOne: false;
            referencedRelation: "profile_avatar_assets";
            referencedColumns: ["id"];
          },
        ];
      };
      reports: {
        Row: {
          admin_note: string | null;
          created_at: string;
          detail: string | null;
          id: string;
          idempotency_key: string;
          outcome_category: string | null;
          reason: string;
          reporter_id: string;
          resolved_at: string | null;
          status: string;
          target_id: string;
          target_kind: string;
          target_ref: string;
          updated_at: string;
        };
        Insert: {
          admin_note?: string | null;
          created_at?: string;
          detail?: string | null;
          id?: string;
          idempotency_key: string;
          outcome_category?: string | null;
          reason: string;
          reporter_id: string;
          resolved_at?: string | null;
          status?: string;
          target_id: string;
          target_kind: string;
          target_ref: string;
          updated_at?: string;
        };
        Update: {
          admin_note?: string | null;
          created_at?: string;
          detail?: string | null;
          id?: string;
          idempotency_key?: string;
          outcome_category?: string | null;
          reason?: string;
          reporter_id?: string;
          resolved_at?: string | null;
          status?: string;
          target_id?: string;
          target_kind?: string;
          target_ref?: string;
          updated_at?: string;
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
      wrap_comments: {
        Row: {
          author_id: string;
          body: string;
          created_at: string;
          id: string;
          idempotency_key: string;
          removed_at: string | null;
          status: string;
          wrap_id: string;
        };
        Insert: {
          author_id: string;
          body: string;
          created_at?: string;
          id?: string;
          idempotency_key: string;
          removed_at?: string | null;
          status?: string;
          wrap_id: string;
        };
        Update: {
          author_id?: string;
          body?: string;
          created_at?: string;
          id?: string;
          idempotency_key?: string;
          removed_at?: string | null;
          status?: string;
          wrap_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wrap_comments_wrap_id_fkey";
            columns: ["wrap_id"];
            isOneToOne: false;
            referencedRelation: "wraps";
            referencedColumns: ["id"];
          },
        ];
      };
      wrap_favorites: {
        Row: {
          created_at: string;
          user_id: string;
          wrap_id: string;
        };
        Insert: {
          created_at?: string;
          user_id: string;
          wrap_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
          wrap_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wrap_favorites_wrap_id_fkey";
            columns: ["wrap_id"];
            isOneToOne: false;
            referencedRelation: "wraps";
            referencedColumns: ["id"];
          },
        ];
      };
      wrap_likes: {
        Row: {
          created_at: string;
          user_id: string;
          wrap_id: string;
        };
        Insert: {
          created_at?: string;
          user_id: string;
          wrap_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
          wrap_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wrap_likes_wrap_id_fkey";
            columns: ["wrap_id"];
            isOneToOne: false;
            referencedRelation: "wraps";
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
      add_wrap_comment: {
        Args: { p_body: string; p_idempotency_key: string; p_slug: string };
        Returns: {
          author_display_name: string;
          author_username: string;
          body: string;
          comment_count: number;
          created_at: string;
          id: string;
          slug: string;
        }[];
      };
      anonymize_expired_profiles: {
        Args: { p_limit?: number };
        Returns: number;
      };
      claim_pending_upload: {
        Args: { p_id: string; p_owner: string };
        Returns: {
          asset_revision_id: string;
          claimed: boolean;
          state: string;
        }[];
      };
      claim_asset_cleanup_jobs: {
        Args: { p_limit?: number };
        Returns: {
          attempts: number;
          bucket_id: string;
          id: string;
          object_key: string;
          pending_upload_id: string;
        }[];
      };
      claim_profile_cleanup_jobs: {
        Args: { p_limit?: number };
        Returns: {
          attempts: number;
          avatar_asset_id: string;
          bucket_id: string;
          id: string;
          object_key: string;
          profile_id: string;
        }[];
      };
      claim_profile_wrap_cleanup_jobs: {
        Args: { p_limit?: number };
        Returns: {
          attempts: number;
          bucket_id: string;
          id: string;
          object_key: string;
          profile_id: string;
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
      complete_asset_cleanup_job: {
        Args: { p_error?: string; p_id: string; p_success: boolean };
        Returns: boolean;
      };
      complete_profile: {
        Args: { p_display_name: string; p_username: string };
        Returns: {
          username: string;
        }[];
      };
      complete_profile_cleanup_job: {
        Args: { p_error?: string; p_id: string; p_success: boolean };
        Returns: boolean;
      };
      complete_profile_wrap_cleanup_job: {
        Args: { p_error?: string; p_id: string; p_success: boolean };
        Returns: boolean;
      };
      consume_otp_failure_limit: {
        Args: { p_email_principal: string; p_network_principal: string };
        Returns: undefined;
      };
      consume_otp_limit: {
        Args: { p_email_principal: string; p_network_principal: string };
        Returns: undefined;
      };
      consume_user_launch_limit: {
        Args: {
          p_error_code?: string;
          p_policy_key: string;
          p_user_id: string;
        };
        Returns: undefined;
      };
      create_report: {
        Args: {
          p_detail: string;
          p_idempotency_key: string;
          p_reason: string;
          p_target: string;
          p_target_kind: string;
        };
        Returns: {
          created: boolean;
          created_at: string;
          detail: string;
          id: string;
          outcome_category: string;
          reason: string;
          resolved_at: string;
          status: string;
          target_id: string;
          target_kind: string;
          updated_at: string;
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
      deactivate_profile: {
        Args: never;
        Returns: {
          deactivated: boolean;
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
      get_creator_follow_state: {
        Args: { p_username: string };
        Returns: {
          following: boolean;
        }[];
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
          favorited: boolean;
          first_published_at: string;
          height_px: number;
          id: string;
          legacy: boolean;
          license_type: string;
          like_count: number;
          liked: boolean;
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
      get_discovery_wraps_base: {
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
      get_my_favorites: {
        Args: { p_limit?: number; p_offset?: number };
        Returns: {
          availability_caveat: string;
          comment_count: number;
          creator_display_name: string;
          creator_username: string;
          description: string;
          download_count: number;
          favorite_count: number;
          favorited: boolean;
          first_published_at: string;
          height_px: number;
          id: string;
          legacy: boolean;
          license_type: string;
          like_count: number;
          liked: boolean;
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
      get_my_report: {
        Args: { p_report_id: string };
        Returns: {
          created_at: string;
          detail: string;
          id: string;
          outcome_category: string;
          reason: string;
          resolved_at: string;
          status: string;
          target_id: string;
          target_kind: string;
          updated_at: string;
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
        Args: { p_offset?: number; p_username: string };
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
      get_public_profile_details: {
        Args: { p_username: string };
        Returns: {
          availability: string;
          avatar_url: string;
          bio: string;
          display_name: string;
          download_count: number;
          ever_published: boolean;
          follower_count: number;
          is_alias: boolean;
          published_wrap_count: number;
          requested_username: string;
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
          favorited: boolean;
          first_published_at: string;
          height_px: number;
          id: string;
          legacy: boolean;
          license_type: string;
          like_count: number;
          liked: boolean;
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
      get_public_wrap_base: {
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
      get_public_wrap_comments: {
        Args: { p_limit?: number; p_offset?: number; p_slug: string };
        Returns: {
          author_display_name: string;
          author_username: string;
          body: string;
          created_at: string;
          id: string;
          owned_by_viewer: boolean;
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
      get_wrap_engagement_state: {
        Args: { p_slug: string };
        Returns: {
          favorite_count: number;
          favorited: boolean;
          like_count: number;
          liked: boolean;
        }[];
      };
      list_admin_reports: {
        Args: { p_status?: string };
        Returns: {
          admin_note: string;
          created_at: string;
          detail: string;
          id: string;
          last_action_at: string;
          last_action_kind: string;
          last_action_reason: string;
          outcome_category: string;
          reason: string;
          reporter_ref: string;
          resolved_at: string;
          status: string;
          target_id: string;
          target_kind: string;
          target_ref: string;
          target_state: string;
          target_summary: string;
          updated_at: string;
        }[];
      };
      moderate_report: {
        Args: {
          p_action_kind: string;
          p_idempotency_key: string;
          p_outcome_category: string;
          p_private_note: string;
          p_reason: string;
          p_report_id: string;
        };
        Returns: {
          action_created: boolean;
          action_id: string;
          outcome_category: string;
          report_id: string;
          report_status: string;
          target_id: string;
          target_kind: string;
          target_state: string;
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
      reconcile_download_counts: { Args: never; Returns: undefined };
      record_discovery_engagement_event: {
        Args: {
          p_actor_id: string;
          p_kind: string;
          p_occurred_at?: string;
          p_wrap_id: string;
        };
        Returns: string;
      };
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
      recover_profile: {
        Args: never;
        Returns: {
          recovered: boolean;
        }[];
      };
      refresh_discovery_ranking: { Args: never; Returns: string };
      remove_wrap: {
        Args: { p_creator_id: string; p_slug: string };
        Returns: {
          first_published_at: string;
          id: string;
          slug: string;
          status: string;
        }[];
      };
      remove_wrap_comment: {
        Args: { p_comment_id: string };
        Returns: {
          comment_count: number;
          id: string;
          removed: boolean;
        }[];
      };
      replace_profile_avatar: {
        Args: {
          p_byte_size: number;
          p_derived_key: string;
          p_height_px: number;
          p_profile_id: string;
          p_sha256: string;
          p_source_key: string;
          p_width_px: number;
        };
        Returns: {
          avatar_url: string;
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
      search_discovery_wraps_for_principal: {
        Args: {
          p_cursor?: string;
          p_limit?: number;
          p_model_slug?: string;
          p_principal_key?: string;
          p_q?: string;
          p_sort?: string;
          p_variant_key?: string;
          p_viewer_id?: string | null;
        };
        Returns: Json;
      };
      search_discovery_wraps_base: {
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
      set_admin_membership: {
        Args: { p_active: boolean; p_user_id: string };
        Returns: boolean;
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
      toggle_creator_follow: {
        Args: { p_enabled: boolean; p_username: string };
        Returns: {
          follower_count: number;
          following: boolean;
        }[];
      };
      toggle_wrap_engagement: {
        Args: { p_enabled: boolean; p_kind: string; p_slug: string };
        Returns: {
          enabled: boolean;
          favorite_count: number;
          kind: string;
          like_count: number;
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
      update_profile: {
        Args: { p_bio: string; p_display_name: string; p_username: string };
        Returns: {
          bio: string;
          display_name: string;
          username: string;
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
