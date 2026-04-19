import { OrderTest } from './order.model';

export interface EnterResultInput {
  values: Record<string, unknown>;
  note?: string;
}

export interface EnterResultResponse {
  orderTest: OrderTest;
  flags: { critical: boolean; notifications: string[] };
}

export interface ValidateInput {
  note?: string;
}

export interface RejectResultInput {
  reason: string;
  note?: string;
}
