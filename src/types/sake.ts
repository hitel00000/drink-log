export type DrinkType = "sake";

export type DrinkAgainValue = "no" | "unsure" | "yes";

export type SweetDryValue = 1 | 2 | 3 | 4 | 5;
export type ThreeStepRatingValue = 1 | 2 | 3;

export type SakeTagGroup = "taste" | "aroma" | "mood";

export interface MoldResponse<T> {
  data: T;
  meta?: {
    total?: number;
    offset?: number;
    limit?: number;
    has_more?: boolean;
  };
}

export interface UserOwnerProfile {
  id: number | string;
  display_name?: string | null;
  avatar_url?: string | null;
  email?: string | null;
}

export interface SakeRecord {
  id: number | string;
  legacy_id?: string | null;
  owner_id: number | string;
  owner?: UserOwnerProfile | null;
  drink_type: DrinkType;
  name: string;
  region: string | null;
  brewery: string | null;
  rice: string | null;
  sake_type: string | null;
  sake_meter_value: string | null;
  abv: string | null;
  volume: string | null;
  price: string | null;
  drink_again: DrinkAgainValue | null;
  sweet_dry: SweetDryValue | null;
  aroma_intensity: ThreeStepRatingValue | null;
  acidity: ThreeStepRatingValue | null;
  clean_umami: ThreeStepRatingValue | null;
  one_line_note: string | null;
  place: string | null;
  consumed_date: string;
  companions: string | null;
  food_pairing: string | null;
  created_at: string;
  updated_at: string;
}

export interface SakeImage {
  id: number | string;
  legacy_id?: string | null;
  owner_id: number | string;
  record_id: number | string;
  image_key: string;
  thumbnail_key: string | null;
  data_url: string;
  thumbnail_data_url: string | null;
  mime_type: string;
  file_name: string;
  display_order: number;
  created_at: string;
}

export interface SakeTag {
  id: number | string;
  legacy_id?: string | null;
  owner_id: number | string | null;
  drink_type: DrinkType;
  tag_group: SakeTagGroup;
  label: string;
  is_default: boolean;
  created_at: string;
}

export interface SakeRecordTag {
  id?: number | string;
  owner_id?: number | string;
  sake_record_id: number | string;
  record_id?: number | string; // Alias for backward compatibility if needed
  tag_id: number | string;
  created_at?: string;
}

export interface SakeRecordEntry {
  id: number | string;
  record: SakeRecord;
  owner?: UserOwnerProfile | null;
  images: SakeImage[];
  tags: SakeTag[];
  record_tags: SakeRecordTag[];
}

export interface SakeDraftImage {
  id: number | string;
  data_url: string;
  thumbnail_data_url?: string;
  mime_type: string;
  file_name: string;
  display_order: number;
}

export interface SakeDraft {
  name: string;
  region: string;
  brewery: string;
  rice: string;
  sake_type: string;
  sake_meter_value: string;
  abv: string;
  volume: string;
  price: string;
  drink_again: DrinkAgainValue | null;
  sweet_dry: SweetDryValue | null;
  aroma_intensity: ThreeStepRatingValue | null;
  acidity: ThreeStepRatingValue | null;
  clean_umami: ThreeStepRatingValue | null;
  one_line_note: string;
  place: string;
  consumed_date: string;
  companions: string;
  food_pairing: string;
  images: SakeDraftImage[];
  selected_tag_ids: (number | string)[];
}
