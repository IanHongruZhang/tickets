export interface Ticket {
  ticket_id: string;
  ticket_name: string;
  operator: string;
  region_code: string;
  region: string;
  region_zh: string;
  is_paper_ticket: boolean;
  is_mobile_ticket: boolean;
  sale_status_raw?: string;
  price_adult_jpy?: number;
  price_child_jpy?: number;
  price_text?: string;
  validity_period_text?: string;
  sales_period_text?: string;
  use_period_text?: string;
  free_area_note?: string;
  usage_conditions?: string;
  official_url?: string;
}

export type Language = 'ja' | 'zh';

export interface AIChatResponse {
  answer: string;
  referenced_ticket_ids: string[];
  sources: { ticket_id: string; ticket_name: string }[];
}