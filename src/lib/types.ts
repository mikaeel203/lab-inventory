export type Role = "lab" | "student";
export type Unit = "L" | "mL" | "µL" | "kg" | "g" | "mg" | "count";
export type Profile = { id: string; role: Role; display_name: string };
export type Lab = { id: string; owner_id: string; name: string; department: string; institution: string };
export type Item = {
  id: string; lab_id: string; name: string; catalogue_number: string | null; barcode: string | null; barcode_format: string | null;
  quantity: number; unit: Unit; product_url: string | null; version: number; archived: boolean; updated_at: string;
  manufacturer_supplier: string | null; container_count: number | null; container_size: number | null;
  minimum_containers: number | null; minimum_quantity: number | null;
};
export type Membership = { id: string; lab_id: string; student_id: string; active: boolean; created_at: string };
export type JoinRequest = {
  id: string; lab_id: string; student_id: string; status: string; created_at: string;
  response: string | null; acknowledged_existing: boolean;
};
export type JoinInbox = JoinRequest & { display_name: string; existing_memberships: number };
export type QuantityRequest = {
  id: string; lab_id: string; item_id: string; item_name: string; student_id: string; quantity: number; unit: Unit;
  base_version: number; status: string; reason: string | null; response: string | null; created_at: string;
  container_count: number | null;
};
export type AuditEvent = { id: string; action: string; created_at: string; details: Record<string, unknown> };
