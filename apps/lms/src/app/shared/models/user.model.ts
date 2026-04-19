export interface User {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  phone?: string;
  authId?: string;
  isActive: boolean;
  createdAt: string;
}

export interface Role {
  id: string;
  tenantId?: string;
  name: string;
  scope: string;
  isPreSeeded: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface Permission {
  id: string;
  code: string;
  name: string;
  module: string;
  description?: string;
}

export interface Notification {
  id: string;
  tenantId: string;
  recipientId: string;
  type: string;
  title: string;
  body?: string;
  referenceId?: string;
  referenceType?: string;
  isRead: boolean;
  readAt?: string;
  createdAt: string;
}
