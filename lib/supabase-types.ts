/**
 * Hand-rolled Supabase row / RPC types.
 *
 * Mirrors the shape supabase-js v2 expects when you call
 * `createClient<Database>(url, key)`. Schemas are derived from the SQL
 * files at repo root (01-supabase-documents.sql through
 * 04-supabase-evals.sql). Keep this file in sync when those change.
 *
 * Why hand-rolled instead of `supabase gen types typescript`: the CLI
 * needs project authentication that isn't available in the audit fix
 * session. Hand-rolling the four tables and one RPC we actually use is
 * cheaper and removes the bulk of the `as any` casts. The generic-CLI
 * approach can replace this file later without API changes to consumers.
 */

// Stored in documents.metadata. The insert shape is fixed in
// app/api/upload/route.ts (source/user_id/resume_id).
export interface DocumentMetadata {
  source: string;
  user_id: string;
  resume_id: string;
  [key: string]: unknown;
}

// Stored in evals.scores. Mirrors lib/evals/coaching-quality.ts.
export interface EvalScores {
  actionability: number;
  personalization: number;
  honesty: number;
  grounding: number;
}

export type Database = {
  public: {
    Tables: {
      documents: {
        Row: {
          id: number;
          content: string;
          embedding: number[];
          metadata: DocumentMetadata;
          created_at: string;
        };
        Insert: {
          id?: number;
          content: string;
          embedding: number[];
          metadata: DocumentMetadata;
          created_at?: string;
        };
        Update: Partial<{
          content: string;
          embedding: number[];
          metadata: DocumentMetadata;
          created_at: string;
        }>;
        Relationships: [];
      };
      evals: {
        Row: {
          id: string;
          response_id: string | null;
          query: string | null;
          response: string | null;
          contexts: string[] | null;
          scores: EvalScores | null;
          reasoning: string | null;
          overall_score: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          response_id?: string | null;
          query?: string | null;
          response?: string | null;
          contexts?: string[] | null;
          scores?: EvalScores | null;
          reasoning?: string | null;
          overall_score?: number | null;
          created_at?: string;
        };
        Update: Partial<{
          response_id: string | null;
          query: string | null;
          response: string | null;
          contexts: string[] | null;
          scores: EvalScores | null;
          reasoning: string | null;
          overall_score: number | null;
          created_at: string;
        }>;
        Relationships: [];
      };
      user_profiles: {
        Row: {
          id: string;
          user_id: string;
          name: string | null;
          current_role: string | null;
          target_role: string | null;
          target_companies: string[];
          skills: string[];
          career_goals: string | null;
          communication_style: string;
          detail_preference: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name?: string | null;
          current_role?: string | null;
          target_role?: string | null;
          target_companies?: string[];
          skills?: string[];
          career_goals?: string | null;
          communication_style?: string;
          detail_preference?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<{
          user_id: string;
          name: string | null;
          current_role: string | null;
          target_role: string | null;
          target_companies: string[];
          skills: string[];
          career_goals: string | null;
          communication_style: string;
          detail_preference: string;
          updated_at: string;
        }>;
        Relationships: [];
      };
      session_memories: {
        Row: {
          id: string;
          user_id: string;
          session_id: string;
          summary: string;
          key_decisions: string[];
          topics_discussed: string[];
          action_items: string[];
          sentiment: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          session_id: string;
          summary: string;
          key_decisions?: string[];
          topics_discussed?: string[];
          action_items?: string[];
          sentiment?: string | null;
          created_at?: string;
        };
        Update: Partial<{
          summary: string;
          key_decisions: string[];
          topics_discussed: string[];
          action_items: string[];
          sentiment: string | null;
        }>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      match_documents_v2: {
        Args: {
          query_embedding: number[];
          match_count?: number;
          p_resume_id?: string | null;
          p_user_id?: string | null;
        };
        Returns: {
          id: number;
          content: string;
          metadata: DocumentMetadata;
          similarity: number;
        }[];
      };
      match_documents: {
        Args: {
          query_embedding: number[];
          match_count?: number;
        };
        Returns: {
          id: number;
          content: string;
          metadata: DocumentMetadata;
          similarity: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];
export type DocumentInsert = Database["public"]["Tables"]["documents"]["Insert"];
export type EvalRow = Database["public"]["Tables"]["evals"]["Row"];
export type EvalInsert = Database["public"]["Tables"]["evals"]["Insert"];
export type UserProfileRow = Database["public"]["Tables"]["user_profiles"]["Row"];
export type UserProfileInsert = Database["public"]["Tables"]["user_profiles"]["Insert"];
export type SessionMemoryRow = Database["public"]["Tables"]["session_memories"]["Row"];
export type SessionMemoryInsert = Database["public"]["Tables"]["session_memories"]["Insert"];
export type MatchDocumentsResult = Database["public"]["Functions"]["match_documents_v2"]["Returns"][number];
