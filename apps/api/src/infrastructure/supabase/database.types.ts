// Subconjunto tipado generado a partir del esquema remoto de KROW.
// Regenerar cuando cambien tablas o funciones consumidas por el backend.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      transport_corridors: {
        Row: {
          corridor_id: string;
          code: string;
          name: string;
          direction: string | null;
          active: boolean;
          display_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          corridor_id?: string;
          code: string;
          name: string;
          direction?: string | null;
          active?: boolean;
          display_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database['public']['Tables']['transport_corridors']['Insert']
        >;
        Relationships: Relationship[];
      };
      users: {
        Row: {
          id: number;
          uuid: string;
          full_name: string | null;
          email_address: string | null;
          institutional_id: string | null;
          academic_program: string | null;
          academic_period: number | null;
          profile_photo: string | null;
          rating: number | null;
          is_active: boolean | null;
          created_at: string;
          updated_at: string | null;
          deleted_at: string | null;
        };
        Insert: {
          id?: never;
          uuid: string;
          full_name?: string | null;
          email_address?: string | null;
          institutional_id?: string | null;
          academic_program?: string | null;
          academic_period?: number | null;
          profile_photo?: string | null;
          rating?: number | null;
          is_active?: boolean | null;
          created_at?: string;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['users']['Insert']>;
        Relationships: Relationship[];
      };
      driver_profiles: {
        Row: {
          driver_id: string;
          user_id: string;
          license_number: string;
          license_expiry: string;
          rating: number | null;
          status: string;
          created_at: string;
        };
        Insert: {
          driver_id?: string;
          user_id: string;
          license_number: string;
          license_expiry: string;
          rating?: number | null;
          status?: string;
          created_at?: string;
        };
        Update: Partial<
          Database['public']['Tables']['driver_profiles']['Insert']
        >;
        Relationships: Relationship[];
      };
      vehicles: {
        Row: {
          vehicle_id: string;
          driver_id: string;
          license_plate: string;
          brand: string;
          model: string;
          car_year: number;
          car_color: string;
          capacity: number;
          is_active: boolean;
        };
        Insert: {
          vehicle_id?: string;
          driver_id: string;
          license_plate: string;
          brand: string;
          model: string;
          car_year: number;
          car_color: string;
          capacity: number;
          is_active?: boolean;
        };
        Update: Partial<Database['public']['Tables']['vehicles']['Insert']>;
        Relationships: Relationship[];
      };
      rides: {
        Row: {
          corridor_id: string | null;
          ride_id: string;
          driver_id: string;
          vehicle_id: string;
          origin_lat: number;
          origin_lng: number;
          destination_lat: number;
          destination_lng: number;
          origin_address: string | null;
          destination_address: string | null;
          route_polyline: string | null;
          favorite_route_id: string | null;
          route_distance_meters: number | null;
          route_duration_seconds: number | null;
          route_provider: string | null;
          route_calculated_at: string | null;
          updated_at: string;
          version: number;
          departure_time: string;
          available_seats: number;
          price_per_seat: number;
          status: string;
          created_at: string;
        };
        Insert: {
          ride_id?: string;
          corridor_id?: string | null;
          driver_id: string;
          vehicle_id: string;
          origin_lat: number;
          origin_lng: number;
          destination_lat: number;
          destination_lng: number;
          origin_address?: string | null;
          destination_address?: string | null;
          route_polyline?: string | null;
          favorite_route_id?: string | null;
          route_distance_meters?: number | null;
          route_duration_seconds?: number | null;
          route_provider?: string | null;
          route_calculated_at?: string | null;
          updated_at?: string;
          version?: number;
          departure_time: string;
          available_seats: number;
          price_per_seat: number;
          status?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['rides']['Insert']>;
        Relationships: Relationship[];
      };
      transport_stops: {
        Row: {
          corridor_id: string | null;
          corridor_order: number | null;
          direction: string | null;
          stop_id: string;
          external_id: string;
          name: string;
          address: string | null;
          municipality: string | null;
          latitude: number;
          longitude: number;
          location: unknown;
          source: string;
          stop_type: string;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          stop_id?: string;
          corridor_id?: string | null;
          corridor_order?: number | null;
          direction?: string | null;
          external_id: string;
          name: string;
          address?: string | null;
          municipality?: string | null;
          latitude: number;
          longitude: number;
          location?: unknown;
          source?: string;
          stop_type?: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database['public']['Tables']['transport_stops']['Insert']
        >;
        Relationships: Relationship[];
      };
      favorite_routes: {
        Row: {
          corridor_id: string | null;
          route_id: string;
          driver_id: string;
          name: string;
          origin_place_id: string | null;
          origin_address: string;
          origin_lat: number;
          origin_lng: number;
          destination_place_id: string | null;
          destination_address: string;
          destination_lat: number;
          destination_lng: number;
          default_vehicle_id: string | null;
          default_available_seats: number | null;
          default_price_per_seat: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          route_id?: string;
          corridor_id?: string | null;
          driver_id: string;
          name: string;
          origin_place_id?: string | null;
          origin_address: string;
          origin_lat: number;
          origin_lng: number;
          destination_place_id?: string | null;
          destination_address: string;
          destination_lat: number;
          destination_lng: number;
          default_vehicle_id?: string | null;
          default_available_seats?: number | null;
          default_price_per_seat?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Database['public']['Tables']['favorite_routes']['Insert']
        >;
        Relationships: Relationship[];
      };
      favorite_route_stops: {
        Row: {
          route_id: string;
          transport_stop_id: string;
          stop_order: number;
          route_fraction: number;
        };
        Insert: {
          route_id: string;
          transport_stop_id: string;
          stop_order: number;
          route_fraction: number;
        };
        Update: Partial<
          Database['public']['Tables']['favorite_route_stops']['Insert']
        >;
        Relationships: Relationship[];
      };
      ride_stops: {
        Row: {
          stop_id: string;
          ride_id: string;
          transport_stop_id: string | null;
          lat: number;
          lng: number;
          address: string;
          stop_order: number;
          route_version: number;
          is_active: boolean;
          route_fraction: number | null;
          location: unknown;
        };
        Insert: {
          stop_id?: string;
          ride_id: string;
          transport_stop_id?: string | null;
          lat: number;
          lng: number;
          address: string;
          stop_order: number;
          route_version?: number;
          is_active?: boolean;
          route_fraction?: number | null;
          location?: unknown;
        };
        Update: Partial<Database['public']['Tables']['ride_stops']['Insert']>;
        Relationships: Relationship[];
      };
      bookings: {
        Row: {
          booking_id: string;
          ride_id: string;
          user_id: string;
          pickup_stop_id: string;
          dropoff_stop_id: string;
          seats_reserved: number;
          status: string;
          created_at: string;
        };
        Insert: {
          booking_id?: string;
          ride_id: string;
          user_id: string;
          pickup_stop_id: string;
          dropoff_stop_id: string;
          seats_reserved?: number;
          status?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['bookings']['Insert']>;
        Relationships: Relationship[];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      search_available_rides_pilot: Database['public']['Functions']['search_available_rides_v2'];
      get_ride_stop_options_pilot: Database['public']['Functions']['get_ride_stop_options'];
      admin_upsert_transport_stop: {
        Args: { p_payload: Json };
        Returns: string;
      };
      create_ride: { Args: { p_payload: Json }; Returns: string };
      create_ride_v2: { Args: { p_payload: Json }; Returns: string };
      update_ride_v2: {
        Args: {
          p_ride_id: string;
          p_expected_version: number;
          p_payload: Json;
        };
        Returns: number;
      };
      find_compatible_transport_stops: {
        Args: { p_route_geojson: Json; p_corridor_m?: number };
        Returns: Array<{
          stop_id: string;
          external_id: string;
          name: string;
          address: string | null;
          municipality: string | null;
          lat: number;
          lng: number;
          distance_from_route_m: number;
          route_fraction: number;
        }>;
      };
      get_passenger_stop_candidates_v2: {
        Args: {
          p_origin_lat: number;
          p_origin_lng: number;
          p_destination_lat: number;
          p_destination_lng: number;
          p_max_distance_m: number;
          p_pickup_scope: 'campus' | 'route';
        };
        Returns: Database['public']['Functions']['get_passenger_stop_candidates']['Returns'];
      };
      get_passenger_stop_pairs_v2: {
        Args: Database['public']['Functions']['get_passenger_stop_candidates_v2']['Args'];
        Returns: Database['public']['Functions']['get_passenger_stop_pairs']['Returns'];
      };
      get_passenger_stop_candidates: {
        Args: {
          p_origin_lat: number;
          p_origin_lng: number;
          p_destination_lat: number;
          p_destination_lng: number;
          p_max_distance_m?: number;
        };
        Returns: Array<{
          stop_role: string;
          stop_id: string;
          external_id: string;
          stop_name: string;
          stop_address: string | null;
          municipality: string | null;
          stop_type: string;
          lat: number;
          lng: number;
          distance_m: number;
          enabled: boolean;
          ride_count: number;
        }>;
      };
      get_passenger_stop_pairs: {
        Args: {
          p_origin_lat: number;
          p_origin_lng: number;
          p_destination_lat: number;
          p_destination_lng: number;
          p_max_distance_m?: number;
        };
        Returns: Array<{
          pickup_transport_stop_id: string;
          dropoff_transport_stop_id: string;
          ride_count: number;
        }>;
      };
      search_available_rides_by_stops: {
        Args: {
          p_origin_lat: number;
          p_origin_lng: number;
          p_destination_lat: number;
          p_destination_lng: number;
          p_pickup_transport_stop_id: string;
          p_dropoff_transport_stop_id: string;
          p_max_results?: number;
          p_from_time?: string | null;
          p_to_time?: string | null;
          p_max_distance_m?: number;
        };
        Returns: Database['public']['Functions']['search_available_rides_v2']['Returns'];
      };
      upsert_favorite_route: {
        Args: { p_payload: Json };
        Returns: string;
      };
      delete_favorite_route: {
        Args: { p_route_id: string };
        Returns: undefined;
      };
      search_available_rides: {
        Args: {
          p_max_results?: number;
          p_from_time?: string | null;
          p_to_time?: string | null;
        };
        Returns: Array<{
          ride_id: string;
          driver_id: string;
          driver_user_id: string;
          driver_name: string | null;
          driver_rating: number | null;
          vehicle_id: string;
          vehicle_brand: string;
          vehicle_model: string;
          vehicle_plate: string;
          vehicle_color: string;
          origin_lat: number;
          origin_lng: number;
          destination_lat: number;
          destination_lng: number;
          origin_address: string | null;
          destination_address: string | null;
          route_polyline: string | null;
          departure_time: string;
          available_seats: number;
          price_per_seat: number;
          status: string;
        }>;
      };
      request_booking: { Args: { p_payload: Json }; Returns: string };
      request_booking_v2: { Args: { p_payload: Json }; Returns: string };
      search_available_rides_v2: {
        Args: {
          p_origin_lat: number;
          p_origin_lng: number;
          p_destination_lat: number;
          p_destination_lng: number;
          p_max_results?: number;
          p_from_time?: string | null;
          p_to_time?: string | null;
          p_max_distance_m?: number;
        };
        Returns: Array<Record<string, Json>>;
      };
      get_ride_stop_options: {
        Args: {
          p_ride_id: string;
          p_origin_lat: number;
          p_origin_lng: number;
          p_destination_lat: number;
          p_destination_lng: number;
          p_max_distance_m?: number;
        };
        Returns: Array<Record<string, Json>>;
      };
      update_booking_status: {
        Args: {
          p_booking_id: string;
          p_new_status: string;
          p_reason?: string;
        };
        Returns: undefined;
      };
      start_ride: { Args: { p_ride_id: string }; Returns: undefined };
      cancel_ride: {
        Args: { p_ride_id: string; p_reason?: string };
        Returns: undefined;
      };
      complete_stop: {
        Args: { p_booking_id: string };
        Returns: undefined;
      };
      complete_ride: {
        Args: { p_ride_id: string };
        Returns: undefined;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type SearchRideRow =
  Database['public']['Functions']['search_available_rides']['Returns'][number];
