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
      fail_pending_upload: {
        Args: { p_code: string; p_detail: Json; p_id: string };
        Returns: undefined;
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
      get_public_profile: {
        Args: { p_username: string };
        Returns: {
          avatar_url: string;
          bio: string;
          display_name: string;
          username: string;
        }[];
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
