/**
 * Slim Supabase schema types for api-server fulfillment.
 * Keep in sync with artifacts/qinaa/src/supabase.ts (generated).
 */
export type Database = {
  public: {
    Tables: {
      payments: {
        Row: {
          amount: number;
          created_at: string;
          currency: string | null;
          environment: string;
          gateway: string;
          gateway_order_id: string;
          id: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          currency?: string | null;
          environment: string;
          gateway: string;
          gateway_order_id: string;
          id?: string;
          status: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          currency?: string | null;
          environment?: string;
          gateway?: string;
          gateway_order_id?: string;
          id?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          id: string;
          is_premium: boolean | null;
          premium_until: string | null;
          username: string | null;
        };
        Insert: {
          created_at?: string;
          id: string;
          is_premium?: boolean | null;
          premium_until?: string | null;
          username?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_premium?: boolean | null;
          premium_until?: string | null;
          username?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      grant_specific_entitlement: {
        Args: { item_id: string; target_user: string };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
