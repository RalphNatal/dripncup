export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      catering_request_items: {
        Row: {
          catering_request_id: string
          created_at: string
          id: string
          notes: string | null
          product_id: string | null
          product_name: string
          quantity: number
        }
        Insert: {
          catering_request_id: string
          created_at?: string
          id?: string
          notes?: string | null
          product_id?: string | null
          product_name: string
          quantity?: number
        }
        Update: {
          catering_request_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          product_id?: string | null
          product_name?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "catering_request_items_catering_request_id_fkey"
            columns: ["catering_request_id"]
            isOneToOne: false
            referencedRelation: "catering_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catering_request_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      catering_requests: {
        Row: {
          anonymized_at: string | null
          budget_cents: number | null
          cancellation_reason: string | null
          cancelled_at: string | null
          confirmed_at: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          custom_drink_request: string | null
          delivery_address: string | null
          event_at: string
          fulfilled_at: string | null
          fulfillment: Database["public"]["Enums"]["fulfillment_type"]
          headcount: number
          id: string
          notes: string | null
          payment_link_url: string | null
          quote_amount_cents: number | null
          quote_notes: string | null
          quoted_at: string | null
          request_number: string
          status: Database["public"]["Enums"]["catering_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          anonymized_at?: string | null
          budget_cents?: number | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          custom_drink_request?: string | null
          delivery_address?: string | null
          event_at: string
          fulfilled_at?: string | null
          fulfillment?: Database["public"]["Enums"]["fulfillment_type"]
          headcount: number
          id?: string
          notes?: string | null
          payment_link_url?: string | null
          quote_amount_cents?: number | null
          quote_notes?: string | null
          quoted_at?: string | null
          request_number?: string
          status?: Database["public"]["Enums"]["catering_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          anonymized_at?: string | null
          budget_cents?: number | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          custom_drink_request?: string | null
          delivery_address?: string | null
          event_at?: string
          fulfilled_at?: string | null
          fulfillment?: Database["public"]["Enums"]["fulfillment_type"]
          headcount?: number
          id?: string
          notes?: string | null
          payment_link_url?: string | null
          quote_amount_cents?: number | null
          quote_notes?: string | null
          quoted_at?: string | null
          request_number?: string
          status?: Database["public"]["Enums"]["catering_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catering_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      closures: {
        Row: {
          closes_at: string | null
          closure_date: string
          created_at: string
          id: string
          is_closed: boolean
          location_id: string | null
          opens_at: string | null
          reason: string | null
          updated_at: string
        }
        Insert: {
          closes_at?: string | null
          closure_date: string
          created_at?: string
          id?: string
          is_closed?: boolean
          location_id?: string | null
          opens_at?: string | null
          reason?: string | null
          updated_at?: string
        }
        Update: {
          closes_at?: string | null
          closure_date?: string
          created_at?: string
          id?: string
          is_closed?: boolean
          location_id?: string | null
          opens_at?: string | null
          reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "closures_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      collection_products: {
        Row: {
          collection_id: string
          created_at: string
          product_id: string
          sort_order: number
        }
        Insert: {
          collection_id: string
          created_at?: string
          product_id: string
          sort_order?: number
        }
        Update: {
          collection_id?: string
          created_at?: string
          product_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "collection_products_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          accent_color: string | null
          banner_image_url: string | null
          created_at: string
          description: string | null
          ends_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          starts_at: string
          updated_at: string
        }
        Insert: {
          accent_color?: string | null
          banner_image_url?: string | null
          created_at?: string
          description?: string | null
          ends_at: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          starts_at: string
          updated_at?: string
        }
        Update: {
          accent_color?: string | null
          banner_image_url?: string | null
          created_at?: string
          description?: string | null
          ends_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          starts_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      daily_counters: {
        Row: {
          counter_day: string
          last_value: number
          scope: string
        }
        Insert: {
          counter_day: string
          last_value?: number
          scope: string
        }
        Update: {
          counter_day?: string
          last_value?: number
          scope?: string
        }
        Relationships: []
      }
      event_menu_items: {
        Row: {
          created_at: string
          location_id: string
          product_id: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          location_id: string
          product_id: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          location_id?: string
          product_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_menu_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_menu_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string
          id: string
          modifiers: Json
          name: string
          product_id: string
          product_size_id: string | null
          quantity: number
          special_instructions: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          modifiers?: Json
          name: string
          product_id: string
          product_size_id?: string | null
          quantity?: number
          special_instructions?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          modifiers?: Json
          name?: string
          product_id?: string
          product_size_id?: string | null
          quantity?: number
          special_instructions?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_product_size_id_fkey"
            columns: ["product_size_id"]
            isOneToOne: false
            referencedRelation: "product_sizes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favorites_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      location_availability: {
        Row: {
          available_from: string | null
          created_at: string
          id: string
          is_available: boolean
          location_id: string
          modifier_option_id: string | null
          product_id: string | null
          reason: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          available_from?: string | null
          created_at?: string
          id?: string
          is_available?: boolean
          location_id: string
          modifier_option_id?: string | null
          product_id?: string | null
          reason?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          available_from?: string | null
          created_at?: string
          id?: string
          is_available?: boolean
          location_id?: string
          modifier_option_id?: string | null
          product_id?: string | null
          reason?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "location_availability_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_availability_modifier_option_id_fkey"
            columns: ["modifier_option_id"]
            isOneToOne: false
            referencedRelation: "modifier_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_availability_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_availability_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      location_hours: {
        Row: {
          closes_at: string
          created_at: string
          day_of_week: number
          id: string
          location_id: string
          opens_at: string
          updated_at: string
        }
        Insert: {
          closes_at: string
          created_at?: string
          day_of_week: number
          id?: string
          location_id: string
          opens_at: string
          updated_at?: string
        }
        Update: {
          closes_at?: string
          created_at?: string
          day_of_week?: number
          id?: string
          location_id?: string
          opens_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_hours_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          accepting_orders: boolean
          address_line1: string | null
          address_line2: string | null
          city: string
          created_at: string
          description: string | null
          ends_at: string | null
          id: string
          image_url: string | null
          is_active: boolean
          latitude: number | null
          longitude: number | null
          name: string
          phone: string | null
          pickup_instructions: string | null
          postal_code: string | null
          prep_time_minutes: number
          slug: string
          sort_order: number
          starts_at: string | null
          state: string
          timezone: string
          type: Database["public"]["Enums"]["location_type"]
          updated_at: string
        }
        Insert: {
          accepting_orders?: boolean
          address_line1?: string | null
          address_line2?: string | null
          city?: string
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          latitude?: number | null
          longitude?: number | null
          name: string
          phone?: string | null
          pickup_instructions?: string | null
          postal_code?: string | null
          prep_time_minutes?: number
          slug: string
          sort_order?: number
          starts_at?: string | null
          state?: string
          timezone?: string
          type?: Database["public"]["Enums"]["location_type"]
          updated_at?: string
        }
        Update: {
          accepting_orders?: boolean
          address_line1?: string | null
          address_line2?: string | null
          city?: string
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          latitude?: number | null
          longitude?: number | null
          name?: string
          phone?: string | null
          pickup_instructions?: string | null
          postal_code?: string | null
          prep_time_minutes?: number
          slug?: string
          sort_order?: number
          starts_at?: string | null
          state?: string
          timezone?: string
          type?: Database["public"]["Enums"]["location_type"]
          updated_at?: string
        }
        Relationships: []
      }
      loyalty_transactions: {
        Row: {
          created_at: string
          description: string | null
          id: string
          order_id: string | null
          points: number
          reward_id: string | null
          type: Database["public"]["Enums"]["loyalty_transaction_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          order_id?: string | null
          points: number
          reward_id?: string | null
          type: Database["public"]["Enums"]["loyalty_transaction_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          order_id?: string | null
          points?: number
          reward_id?: string | null
          type?: Database["public"]["Enums"]["loyalty_transaction_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "rewards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      modifier_groups: {
        Row: {
          charge_per_quantity: boolean
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_required: boolean
          max_quantity_per_option: number
          max_selections: number | null
          min_selections: number
          name: string
          quantity_unit: string | null
          selection_type: Database["public"]["Enums"]["modifier_selection_type"]
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          charge_per_quantity?: boolean
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_required?: boolean
          max_quantity_per_option?: number
          max_selections?: number | null
          min_selections?: number
          name: string
          quantity_unit?: string | null
          selection_type?: Database["public"]["Enums"]["modifier_selection_type"]
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          charge_per_quantity?: boolean
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_required?: boolean
          max_quantity_per_option?: number
          max_selections?: number | null
          min_selections?: number
          name?: string
          quantity_unit?: string | null
          selection_type?: Database["public"]["Enums"]["modifier_selection_type"]
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      modifier_options: {
        Row: {
          allergens: Database["public"]["Enums"]["allergen"][]
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_default: boolean
          max_quantity: number
          modifier_group_id: string
          name: string
          price_delta_cents: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          allergens?: Database["public"]["Enums"]["allergen"][]
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          max_quantity?: number
          modifier_group_id: string
          name: string
          price_delta_cents?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          allergens?: Database["public"]["Enums"]["allergen"][]
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          max_quantity?: number
          modifier_group_id?: string
          name?: string
          price_delta_cents?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "modifier_options_modifier_group_id_fkey"
            columns: ["modifier_group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          base_price_cents: number
          created_at: string
          id: string
          line_total_cents: number
          modifiers: Json
          order_id: string
          product_id: string | null
          product_name: string
          product_size_id: string | null
          quantity: number
          size_name: string | null
          special_instructions: string | null
          unit_price_cents: number
        }
        Insert: {
          base_price_cents: number
          created_at?: string
          id?: string
          line_total_cents: number
          modifiers?: Json
          order_id: string
          product_id?: string | null
          product_name: string
          product_size_id?: string | null
          quantity?: number
          size_name?: string | null
          special_instructions?: string | null
          unit_price_cents: number
        }
        Update: {
          base_price_cents?: number
          created_at?: string
          id?: string
          line_total_cents?: number
          modifiers?: Json
          order_id?: string
          product_id?: string | null
          product_name?: string
          product_size_id?: string | null
          quantity?: number
          size_name?: string | null
          special_instructions?: string | null
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_size_id_fkey"
            columns: ["product_size_id"]
            isOneToOne: false
            referencedRelation: "product_sizes"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_history: {
        Row: {
          changed_by: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["order_status"] | null
          id: string
          order_id: string
          reason: string | null
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: string
          order_id: string
          reason?: string | null
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["order_status"] | null
          id?: string
          order_id?: string
          reason?: string | null
          to_status?: Database["public"]["Enums"]["order_status"]
        }
        Relationships: [
          {
            foreignKeyName: "order_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_status_history_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          accepted_at: string | null
          anonymized_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          checkout_fingerprint: string | null
          created_at: string
          customer_email: string | null
          customer_first_name: string | null
          customer_phone: string | null
          discount_cents: number
          estimated_ready_at: string | null
          flagged_for_review_at: string | null
          fulfillment: Database["public"]["Enums"]["fulfillment_type"]
          id: string
          idempotency_key: string
          location_id: string
          notes: string | null
          order_number: string
          picked_up_at: string | null
          pickup_type: Database["public"]["Enums"]["pickup_type"]
          placed_at: string | null
          points_earned: number
          points_redeemed: number
          preparing_at: string | null
          promo_code: string | null
          promo_id: string | null
          ready_at: string | null
          review_reason: string | null
          reward_id: string | null
          reward_name: string | null
          scheduled_for: string | null
          status: Database["public"]["Enums"]["order_status"]
          subtotal_cents: number
          tax_cents: number
          tax_rate: number
          taxable_base_cents: number
          tip_cents: number
          total_cents: number
          updated_at: string
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          anonymized_at?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          checkout_fingerprint?: string | null
          created_at?: string
          customer_email?: string | null
          customer_first_name?: string | null
          customer_phone?: string | null
          discount_cents?: number
          estimated_ready_at?: string | null
          flagged_for_review_at?: string | null
          fulfillment?: Database["public"]["Enums"]["fulfillment_type"]
          id?: string
          idempotency_key: string
          location_id: string
          notes?: string | null
          order_number?: string
          picked_up_at?: string | null
          pickup_type?: Database["public"]["Enums"]["pickup_type"]
          placed_at?: string | null
          points_earned?: number
          points_redeemed?: number
          preparing_at?: string | null
          promo_code?: string | null
          promo_id?: string | null
          ready_at?: string | null
          review_reason?: string | null
          reward_id?: string | null
          reward_name?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_cents?: number
          tax_cents?: number
          tax_rate?: number
          taxable_base_cents?: number
          tip_cents?: number
          total_cents?: number
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          anonymized_at?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          checkout_fingerprint?: string | null
          created_at?: string
          customer_email?: string | null
          customer_first_name?: string | null
          customer_phone?: string | null
          discount_cents?: number
          estimated_ready_at?: string | null
          flagged_for_review_at?: string | null
          fulfillment?: Database["public"]["Enums"]["fulfillment_type"]
          id?: string
          idempotency_key?: string
          location_id?: string
          notes?: string | null
          order_number?: string
          picked_up_at?: string | null
          pickup_type?: Database["public"]["Enums"]["pickup_type"]
          placed_at?: string | null
          points_earned?: number
          points_redeemed?: number
          preparing_at?: string | null
          promo_code?: string | null
          promo_id?: string | null
          ready_at?: string | null
          review_reason?: string | null
          reward_id?: string | null
          reward_name?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_cents?: number
          tax_cents?: number
          tax_rate?: number
          taxable_base_cents?: number
          tip_cents?: number
          total_cents?: number
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_promo_id_fkey"
            columns: ["promo_id"]
            isOneToOne: false
            referencedRelation: "promos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_reward_id_fkey"
            columns: ["reward_id"]
            isOneToOne: false
            referencedRelation: "rewards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          failure_code: string | null
          failure_message: string | null
          id: string
          order_id: string
          provider: string
          provider_charge_id: string | null
          provider_customer_id: string | null
          provider_payment_intent_id: string | null
          raw: Json | null
          refunded_cents: number
          status: Database["public"]["Enums"]["payment_status"]
          tip_cents: number
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          order_id: string
          provider?: string
          provider_charge_id?: string | null
          provider_customer_id?: string | null
          provider_payment_intent_id?: string | null
          raw?: Json | null
          refunded_cents?: number
          status?: Database["public"]["Enums"]["payment_status"]
          tip_cents?: number
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          order_id?: string
          provider?: string
          provider_charge_id?: string | null
          provider_customer_id?: string | null
          provider_payment_intent_id?: string | null
          raw?: Json | null
          refunded_cents?: number
          status?: Database["public"]["Enums"]["payment_status"]
          tip_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      product_modifier_groups: {
        Row: {
          created_at: string
          modifier_group_id: string
          override_is_required: boolean | null
          override_max_selections: number | null
          override_min_selections: number | null
          product_id: string
          sort_order: number
          visible_when_option_id: string | null
        }
        Insert: {
          created_at?: string
          modifier_group_id: string
          override_is_required?: boolean | null
          override_max_selections?: number | null
          override_min_selections?: number | null
          product_id: string
          sort_order?: number
          visible_when_option_id?: string | null
        }
        Update: {
          created_at?: string
          modifier_group_id?: string
          override_is_required?: boolean | null
          override_max_selections?: number | null
          override_min_selections?: number | null
          product_id?: string
          sort_order?: number
          visible_when_option_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_modifier_groups_modifier_group_id_fkey"
            columns: ["modifier_group_id"]
            isOneToOne: false
            referencedRelation: "modifier_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_modifier_groups_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_modifier_groups_visible_when_option_id_fkey"
            columns: ["visible_when_option_id"]
            isOneToOne: false
            referencedRelation: "modifier_options"
            referencedColumns: ["id"]
          },
        ]
      }
      product_sizes: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          price_cents: number
          product_id: string
          sort_order: number
          updated_at: string
          volume_oz: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          price_cents: number
          product_id: string
          sort_order?: number
          updated_at?: string
          volume_oz?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          price_cents?: number
          product_id?: string
          sort_order?: number
          updated_at?: string
          volume_oz?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_sizes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          allergens: Database["public"]["Enums"]["allergen"][]
          base_price_cents: number
          calories: number | null
          category_id: string | null
          created_at: string
          description: string | null
          dietary_tags: Database["public"]["Enums"]["dietary_tag"][]
          id: string
          image_url: string | null
          is_active: boolean
          is_catering_eligible: boolean
          name: string
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          allergens?: Database["public"]["Enums"]["allergen"][]
          base_price_cents?: number
          calories?: number | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          dietary_tags?: Database["public"]["Enums"]["dietary_tag"][]
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_catering_eligible?: boolean
          name: string
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          allergens?: Database["public"]["Enums"]["allergen"][]
          base_price_cents?: number
          calories?: number | null
          category_id?: string | null
          created_at?: string
          description?: string | null
          dietary_tags?: Database["public"]["Enums"]["dietary_tag"][]
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_catering_eligible?: boolean
          name?: string
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          deleted_at: string | null
          email: string | null
          first_name: string | null
          full_name: string | null
          id: string
          loyalty_points: number
          marketing_opt_in: boolean
          member_code: string
          notification_prefs: Json
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          sms_opt_in: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id: string
          loyalty_points?: number
          marketing_opt_in?: boolean
          member_code?: string
          notification_prefs?: Json
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          sms_opt_in?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          loyalty_points?: number
          marketing_opt_in?: boolean
          member_code?: string
          notification_prefs?: Json
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          sms_opt_in?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      promo_redemptions: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          order_id: string
          promo_id: string
          user_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          order_id: string
          promo_id: string
          user_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          order_id?: string
          promo_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promo_redemptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_redemptions_promo_id_fkey"
            columns: ["promo_id"]
            isOneToOne: false
            referencedRelation: "promos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_redemptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      promos: {
        Row: {
          amount_cents: number | null
          code: string
          created_at: string
          description: string | null
          ends_at: string | null
          id: string
          is_active: boolean
          max_discount_cents: number | null
          min_spend_cents: number
          per_user_limit: number | null
          percent: number | null
          starts_at: string
          times_used: number
          type: Database["public"]["Enums"]["promo_type"]
          updated_at: string
          usage_limit: number | null
        }
        Insert: {
          amount_cents?: number | null
          code: string
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          max_discount_cents?: number | null
          min_spend_cents?: number
          per_user_limit?: number | null
          percent?: number | null
          starts_at?: string
          times_used?: number
          type: Database["public"]["Enums"]["promo_type"]
          updated_at?: string
          usage_limit?: number | null
        }
        Update: {
          amount_cents?: number | null
          code?: string
          created_at?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          max_discount_cents?: number | null
          min_spend_cents?: number
          per_user_limit?: number | null
          percent?: number | null
          starts_at?: string
          times_used?: number
          type?: Database["public"]["Enums"]["promo_type"]
          updated_at?: string
          usage_limit?: number | null
        }
        Relationships: []
      }
      rate_limit_hits: {
        Row: {
          hits: number
          key: string
          window_start: string
        }
        Insert: {
          hits?: number
          key: string
          window_start: string
        }
        Update: {
          hits?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      refunds: {
        Row: {
          amount_cents: number
          attempts: number
          created_at: string
          failure_reason: string | null
          id: string
          order_id: string
          payment_id: string | null
          provider: string
          provider_refund_id: string | null
          reason: string
          requested_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          attempts?: number
          created_at?: string
          failure_reason?: string | null
          id?: string
          order_id: string
          payment_id?: string | null
          provider?: string
          provider_refund_id?: string | null
          reason: string
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          attempts?: number
          created_at?: string
          failure_reason?: string | null
          id?: string
          order_id?: string
          payment_id?: string | null
          provider?: string
          provider_refund_id?: string | null
          reason?: string
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rewards: {
        Row: {
          applicable_category_ids: string[]
          applicable_product_ids: string[]
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          percent: number | null
          points_cost: number
          sort_order: number
          type: Database["public"]["Enums"]["reward_type"]
          updated_at: string
          value_cents: number | null
        }
        Insert: {
          applicable_category_ids?: string[]
          applicable_product_ids?: string[]
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          percent?: number | null
          points_cost: number
          sort_order?: number
          type: Database["public"]["Enums"]["reward_type"]
          updated_at?: string
          value_cents?: number | null
        }
        Update: {
          applicable_category_ids?: string[]
          applicable_product_ids?: string[]
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          percent?: number | null
          points_cost?: number
          sort_order?: number
          type?: Database["public"]["Enums"]["reward_type"]
          updated_at?: string
          value_cents?: number | null
        }
        Relationships: []
      }
      settings: {
        Row: {
          description: string | null
          is_public: boolean
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          is_public?: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          is_public?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_locations: {
        Row: {
          created_at: string
          location_id: string
          profile_id: string
        }
        Insert: {
          created_at?: string
          location_id: string
          profile_id: string
        }
        Update: {
          created_at?: string
          location_id?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_locations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          attempted_at: string
          attempts: number
          id: string
          last_error: string | null
          processed_at: string | null
          provider: string
          received_at: string
          status: string
          type: string
        }
        Insert: {
          attempted_at?: string
          attempts?: number
          id: string
          last_error?: string | null
          processed_at?: string | null
          provider?: string
          received_at?: string
          status?: string
          type: string
        }
        Update: {
          attempted_at?: string
          attempts?: number
          id?: string
          last_error?: string | null
          processed_at?: string | null
          provider?: string
          received_at?: string
          status?: string
          type?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_refund_state: {
        Args: {
          p_payment_intent_id: string
          p_reason?: string
          p_refunded_cents: number
        }
        Returns: string
      }
      auth_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      cafe_clock: { Args: never; Returns: string }
      cafe_date: { Args: { instant: string }; Returns: string }
      cafe_today: { Args: never; Returns: string }
      can_access_location: {
        Args: { target_location_id: string }
        Returns: boolean
      }
      create_checkout_order: {
        Args: { p_items: Json; p_order: Json }
        Returns: {
          created: boolean
          order_id: string
        }[]
      }
      delete_account_data: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      get_promo_for_checkout: {
        Args: {
          p_code: string
          p_exclude_idempotency_key?: string
          p_user_id: string
        }
        Returns: Json
      }
      get_setting: { Args: { setting_key: string }; Returns: Json }
      is_admin: { Args: never; Returns: boolean }
      is_staff: { Args: never; Returns: boolean }
      is_valid_order_transition: {
        Args: {
          from_status: Database["public"]["Enums"]["order_status"]
          to_status: Database["public"]["Enums"]["order_status"]
        }
        Returns: boolean
      }
      mark_order_paid: {
        Args: {
          p_amount_cents: number
          p_charge_id: string
          p_currency: string
          p_order_id: string
          p_payment_intent_id: string
          p_raw?: Json
          p_reject_reason?: string
        }
        Returns: string
      }
      next_catering_number: { Args: { as_of?: string }; Returns: string }
      next_daily_number: {
        Args: { as_of?: string; counter_scope: string }
        Returns: number
      }
      next_order_number: { Args: { as_of?: string }; Returns: string }
      rate_limit_hit: {
        Args: {
          p_cost?: number
          p_key: string
          p_limit: number
          p_window_seconds: number
        }
        Returns: boolean
      }
      record_payment_failure: {
        Args: { p_code: string; p_message: string; p_payment_intent_id: string }
        Returns: boolean
      }
      set_location_accepting_orders: {
        Args: { accepting: boolean; target_location_id: string }
        Returns: {
          accepting_orders: boolean
          address_line1: string | null
          address_line2: string | null
          city: string
          created_at: string
          description: string | null
          ends_at: string | null
          id: string
          image_url: string | null
          is_active: boolean
          latitude: number | null
          longitude: number | null
          name: string
          phone: string | null
          pickup_instructions: string | null
          postal_code: string | null
          prep_time_minutes: number
          slug: string
          sort_order: number
          starts_at: string | null
          state: string
          timezone: string
          type: Database["public"]["Enums"]["location_type"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "locations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      allergen:
        | "dairy"
        | "tree_nuts"
        | "macadamia"
        | "peanuts"
        | "gluten"
        | "soy"
        | "egg"
        | "sesame"
      catering_status:
        | "submitted"
        | "quoted"
        | "confirmed"
        | "fulfilled"
        | "cancelled"
      dietary_tag:
        | "vegan"
        | "vegetarian"
        | "dairy_free"
        | "gluten_free"
        | "nut_free"
        | "contains_caffeine"
        | "decaf"
      fulfillment_type: "pickup" | "delivery"
      location_type: "cafe" | "event"
      loyalty_transaction_type: "earn" | "redeem" | "adjust" | "reverse"
      modifier_selection_type: "single" | "multi"
      order_status:
        | "pending_payment"
        | "placed"
        | "accepted"
        | "preparing"
        | "ready"
        | "picked_up"
        | "cancelled"
        | "refunded"
      payment_status:
        | "requires_payment"
        | "processing"
        | "succeeded"
        | "failed"
        | "cancelled"
        | "refunded"
        | "partially_refunded"
      pickup_type: "asap" | "scheduled"
      promo_type: "percent" | "fixed"
      reward_type: "free_item" | "free_addon" | "percent_off" | "amount_off"
      user_role: "customer" | "staff" | "admin"
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
      allergen: [
        "dairy",
        "tree_nuts",
        "macadamia",
        "peanuts",
        "gluten",
        "soy",
        "egg",
        "sesame",
      ],
      catering_status: [
        "submitted",
        "quoted",
        "confirmed",
        "fulfilled",
        "cancelled",
      ],
      dietary_tag: [
        "vegan",
        "vegetarian",
        "dairy_free",
        "gluten_free",
        "nut_free",
        "contains_caffeine",
        "decaf",
      ],
      fulfillment_type: ["pickup", "delivery"],
      location_type: ["cafe", "event"],
      loyalty_transaction_type: ["earn", "redeem", "adjust", "reverse"],
      modifier_selection_type: ["single", "multi"],
      order_status: [
        "pending_payment",
        "placed",
        "accepted",
        "preparing",
        "ready",
        "picked_up",
        "cancelled",
        "refunded",
      ],
      payment_status: [
        "requires_payment",
        "processing",
        "succeeded",
        "failed",
        "cancelled",
        "refunded",
        "partially_refunded",
      ],
      pickup_type: ["asap", "scheduled"],
      promo_type: ["percent", "fixed"],
      reward_type: ["free_item", "free_addon", "percent_off", "amount_off"],
      user_role: ["customer", "staff", "admin"],
    },
  },
} as const

