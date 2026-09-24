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
          completed_at: string | null;
          created_at: string;
          currency: string | null;
          environment: string;
          gateway: string;
          gateway_order_id: string | null;
          gateway_payment_id: string | null;
          id: string;
          idempotency_key: string | null;
          item_id: string | null;
          merchant_order_number: string | null;
          payment_method: string | null;
          refunded_at: string | null;
          status: string;
          updated_at: string;
          user_id: string;
          verified_at: string | null;
        };
        Insert: {
          amount: number;
          completed_at?: string | null;
          created_at?: string;
          currency?: string | null;
          environment: string;
          gateway: string;
          gateway_order_id?: string | null;
          gateway_payment_id?: string | null;
          id?: string;
          idempotency_key?: string | null;
          item_id?: string | null;
          merchant_order_number?: string | null;
          payment_method?: string | null;
          refunded_at?: string | null;
          status: string;
          updated_at?: string;
          user_id: string;
          verified_at?: string | null;
        };
        Update: {
          amount?: number;
          completed_at?: string | null;
          created_at?: string;
          currency?: string | null;
          environment?: string;
          gateway?: string;
          gateway_order_id?: string | null;
          gateway_payment_id?: string | null;
          id?: string;
          idempotency_key?: string | null;
          item_id?: string | null;
          merchant_order_number?: string | null;
          payment_method?: string | null;
          refunded_at?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
          verified_at?: string | null;
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
      user_entitlements: {
        Row: {
          created_at: string;
          games_played: number;
          has_all_access: boolean;
          has_base_game: boolean;
          id: string;
          owned_items: string[];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          games_played?: number;
          has_all_access?: boolean;
          has_base_game?: boolean;
          id: string;
          owned_items?: string[];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          games_played?: number;
          has_all_access?: boolean;
          has_base_game?: boolean;
          id?: string;
          owned_items?: string[];
          updated_at?: string;
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
      complete_verified_paylink_payment: {
        Args: {
          expected_amount: number;
          expected_currency: string;
          expected_transaction_no: string;
          target_payment: string;
        };
        Returns: Array<{
          already_completed: boolean;
          item_id: string;
          user_id: string;
        }>;
      };
      complete_verified_nalpay_payment: {
        Args: {
          expected_amount: number;
          expected_currency: string;
          expected_event_id: string | null;
          expected_link_id: string;
          expected_payment_id: string;
          target_payment: string;
        };
        Returns: Array<{
          already_completed: boolean;
          item_id: string;
          user_id: string;
        }>;
      };
      refund_verified_nalpay_payment: {
        Args: {
          expected_event_id: string | null;
          expected_link_id: string;
          expected_payment_id: string;
          target_payment: string;
        };
        Returns: Array<{
          already_refunded: boolean;
          item_id: string;
          user_id: string;
        }>;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
