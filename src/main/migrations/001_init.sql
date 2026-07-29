-- 001_init.sql — initial schema (SQLite), converted from dormitory.sql (MySQL Workbench).
-- IMMUTABLE once shipped. Further changes go in 002_*.sql, even to fix a typo.
--
-- Conversion rules applied:
--   VARCHAR/TIMESTAMP/DATE/ENUM -> TEXT ; TINYINT -> INTEGER (0/1) ; money *_cents -> INTEGER
--   meter readings / rates / quantities keep DECIMAL (NUMERIC affinity)
--   AUTO_INCREMENT -> INTEGER PRIMARY KEY AUTOINCREMENT (single-column only)
--   MySQL composite PKs on junction tables -> surrogate id + UNIQUE(...)
--   inline INDEX ... VISIBLE -> separate CREATE INDEX
--   ENUM values are stored as TEXT and validated in JS (allowed sets noted in comments)

-- -----------------------------------------------------
-- users
-- -----------------------------------------------------
CREATE TABLE users (
  user_id             INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name           TEXT NOT NULL,
  phone               TEXT NOT NULL,
  password            TEXT NOT NULL,
  email               TEXT,
  recovery_code_hash  TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- -----------------------------------------------------
-- roles
-- -----------------------------------------------------
CREATE TABLE roles (
  role_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- -----------------------------------------------------
-- permissions
-- -----------------------------------------------------
CREATE TABLE permissions (
  permission_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  module         TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- -----------------------------------------------------
-- user_roles (junction: users <-> roles)
-- -----------------------------------------------------
CREATE TABLE user_roles (
  user_role_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  role_id       INTEGER NOT NULL,
  UNIQUE (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users (user_id),
  FOREIGN KEY (role_id) REFERENCES roles (role_id)
);
CREATE INDEX idx_user_roles_user ON user_roles (user_id);
CREATE INDEX idx_user_roles_role ON user_roles (role_id);

-- -----------------------------------------------------
-- role_permission (junction: roles <-> permissions)
-- -----------------------------------------------------
CREATE TABLE role_permission (
  role_permission_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  permission_id       INTEGER NOT NULL,
  role_id             INTEGER NOT NULL,
  UNIQUE (permission_id, role_id),
  FOREIGN KEY (permission_id) REFERENCES permissions (permission_id),
  FOREIGN KEY (role_id) REFERENCES roles (role_id)
);
CREATE INDEX idx_role_permission_permission ON role_permission (permission_id);
CREATE INDEX idx_role_permission_role ON role_permission (role_id);

-- -----------------------------------------------------
-- apartments
-- -----------------------------------------------------
CREATE TABLE apartments (
  apartment_id                INTEGER PRIMARY KEY AUTOINCREMENT,
  logo_url                    TEXT,
  name_th                     TEXT NOT NULL,
  name_en                     TEXT,
  address_th                  TEXT NOT NULL,
  address_en                  TEXT,
  description                 TEXT,
  phone                       TEXT,
  late_fee_per_day_cents      INTEGER NOT NULL,
  is_auto_late_fee_enabled    INTEGER NOT NULL DEFAULT 1,
  due_date_day                INTEGER NOT NULL,
  is_vat_enabled              INTEGER,
  qr_code_image               TEXT,
  payment_instructions        TEXT,
  show_tenant_info_in_invoice INTEGER NOT NULL DEFAULT 1,
  show_unit_qty_in_invoice    INTEGER NOT NULL DEFAULT 1,
  default_rent_item_text      TEXT DEFAULT 'ค่าเช่าห้อง/Rent',
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT
);

-- -----------------------------------------------------
-- apartment_services
-- -----------------------------------------------------
CREATE TABLE apartment_services (
  service_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  apartment_id    INTEGER NOT NULL,
  name            TEXT NOT NULL,
  price_cents     INTEGER NOT NULL,
  is_vat_enabled  INTEGER,
  is_meter_based  INTEGER,
  created_at      TEXT NOT NULL,
  updated_at      TEXT,
  FOREIGN KEY (apartment_id) REFERENCES apartments (apartment_id)
);
CREATE INDEX idx_apartment_services_apartment ON apartment_services (apartment_id);

-- -----------------------------------------------------
-- apartment_bank_accounts
-- -----------------------------------------------------
CREATE TABLE apartment_bank_accounts (
  bank_account_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  apartment_id     INTEGER NOT NULL,
  bank_name        TEXT,
  account_name     TEXT,
  account_number   TEXT,
  is_default       INTEGER,
  created_at       TEXT NOT NULL,
  updated_at       TEXT,
  FOREIGN KEY (apartment_id) REFERENCES apartments (apartment_id)
);
CREATE INDEX idx_bank_accounts_apartment ON apartment_bank_accounts (apartment_id);

-- -----------------------------------------------------
-- floors
-- -----------------------------------------------------
CREATE TABLE floors (
  floor_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  apartment_id  INTEGER NOT NULL,
  floor_name    TEXT NOT NULL,
  room_count    INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT,
  FOREIGN KEY (apartment_id) REFERENCES apartments (apartment_id)
);
CREATE INDEX idx_floors_apartment ON floors (apartment_id);

-- -----------------------------------------------------
-- room_types
-- -----------------------------------------------------
CREATE TABLE room_types (
  room_type_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  apartment_id  INTEGER NOT NULL,
  name          TEXT,
  created_at    TEXT,
  updated_at    TEXT,
  FOREIGN KEY (apartment_id) REFERENCES apartments (apartment_id)
);
CREATE INDEX idx_room_types_apartment ON room_types (apartment_id);

-- -----------------------------------------------------
-- rooms
-- -----------------------------------------------------
-- status allowed: 'vacant' | 'occupied' | 'maintenance'
CREATE TABLE rooms (
  room_id            INTEGER PRIMARY KEY AUTOINCREMENT,
  floor_id           INTEGER NOT NULL,
  room_type_id       INTEGER NOT NULL,
  room_number        TEXT NOT NULL,
  is_active          INTEGER NOT NULL,
  monthly_rent_cents INTEGER NOT NULL,
  daily_rent_cents   INTEGER,
  status             TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT,
  FOREIGN KEY (floor_id) REFERENCES floors (floor_id),
  FOREIGN KEY (room_type_id) REFERENCES room_types (room_type_id)
);
CREATE INDEX idx_rooms_floor ON rooms (floor_id);
CREATE INDEX idx_rooms_room_type ON rooms (room_type_id);

-- -----------------------------------------------------
-- room_utility_settings (1:1 with rooms)
-- -----------------------------------------------------
-- water_billing_type / electric_billing_type allowed: 'actual' | 'minimum' | 'flat'
CREATE TABLE room_utility_settings (
  utility_setting_id               INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id                          INTEGER NOT NULL UNIQUE,
  is_water_enabled                 INTEGER NOT NULL DEFAULT 1,
  water_billing_type               TEXT NOT NULL,
  water_unit_price_cents           INTEGER NOT NULL,
  water_min_charge_cents           INTEGER NOT NULL,
  water_flat_rate_cents            INTEGER NOT NULL,
  show_water_reading_in_invoice    INTEGER NOT NULL DEFAULT 1,
  is_electric_enabled              INTEGER NOT NULL DEFAULT 1,
  electric_billing_type            TEXT NOT NULL,
  electric_unit_price_cents        INTEGER NOT NULL,
  electric_min_charge_cents        INTEGER NOT NULL,
  electric_flat_rate_cents         INTEGER NOT NULL,
  show_electric_reading_in_invoice INTEGER NOT NULL DEFAULT 1,
  created_at                       TEXT NOT NULL,
  updated_at                       TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms (room_id)
);

-- -----------------------------------------------------
-- room_services (junction: apartment_services <-> rooms)
-- -----------------------------------------------------
CREATE TABLE room_services (
  room_service_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  apartment_service_id  INTEGER NOT NULL,
  room_id               INTEGER NOT NULL,
  created_at            TEXT,
  updated_at            TEXT,
  UNIQUE (apartment_service_id, room_id),
  FOREIGN KEY (apartment_service_id) REFERENCES apartment_services (service_id),
  FOREIGN KEY (room_id) REFERENCES rooms (room_id)
);
CREATE INDEX idx_room_services_room ON room_services (room_id);
CREATE INDEX idx_room_services_service ON room_services (apartment_service_id);

-- -----------------------------------------------------
-- users_apartments (junction: users <-> apartments)
-- -----------------------------------------------------
CREATE TABLE users_apartments (
  users_apartments_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              INTEGER NOT NULL,
  apartment_id         INTEGER NOT NULL,
  UNIQUE (user_id, apartment_id),
  FOREIGN KEY (user_id) REFERENCES users (user_id),
  FOREIGN KEY (apartment_id) REFERENCES apartments (apartment_id)
);
CREATE INDEX idx_users_apartments_user ON users_apartments (user_id);
CREATE INDEX idx_users_apartments_apartment ON users_apartments (apartment_id);

-- -----------------------------------------------------
-- tenants
-- -----------------------------------------------------
CREATE TABLE tenants (
  tenant_id               INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name              TEXT NOT NULL,
  last_name               TEXT NOT NULL,
  phone                   TEXT NOT NULL UNIQUE,
  id_card_no              TEXT NOT NULL UNIQUE,
  address                 TEXT,
  emergency_contact_name  TEXT,
  emergency_relation      TEXT,
  emergency_phone         TEXT,
  note                    TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT
);

-- -----------------------------------------------------
-- contracts
-- -----------------------------------------------------
-- rent_type allowed: 'monthly' | 'daily'   status allowed: 'active' | 'inactive'
CREATE TABLE contracts (
  contract_id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id                      INTEGER NOT NULL,
  tenant_id                    INTEGER NOT NULL,
  rent_type                    TEXT NOT NULL,
  start_date                   TEXT NOT NULL,
  end_date                     TEXT,
  rent_amount_cents            INTEGER NOT NULL,
  deposit_amount_cents         INTEGER NOT NULL,
  deposit_payment_method       TEXT NOT NULL,
  booking_fee_cents            INTEGER NOT NULL,
  booking_receipt_no           TEXT,
  advance_payment_amount_cents INTEGER NOT NULL,
  water_meter_start            DECIMAL(10,2) NOT NULL,
  electric_meter_start         DECIMAL(10,2) NOT NULL,
  note                         TEXT,
  status                       TEXT NOT NULL,
  created_at                   TEXT NOT NULL,
  updated_at                   TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms (room_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants (tenant_id)
);
CREATE INDEX idx_contracts_room ON contracts (room_id);
CREATE INDEX idx_contracts_tenant ON contracts (tenant_id);

-- -----------------------------------------------------
-- contract_services (junction: contracts <-> apartment_services)
-- -----------------------------------------------------
CREATE TABLE contract_services (
  contract_service_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id           INTEGER NOT NULL,
  apartment_service_id  INTEGER NOT NULL,
  price_cents           INTEGER NOT NULL,
  UNIQUE (contract_id, apartment_service_id),
  FOREIGN KEY (contract_id) REFERENCES contracts (contract_id),
  FOREIGN KEY (apartment_service_id) REFERENCES apartment_services (service_id)
);
CREATE INDEX idx_contract_services_contract ON contract_services (contract_id);
CREATE INDEX idx_contract_services_service ON contract_services (apartment_service_id);

-- -----------------------------------------------------
-- room_bookings
-- -----------------------------------------------------
-- rent_type allowed: 'monthly' | 'daily'
-- status allowed: 'pending' | 'confirmed' | 'converted_to_contract' | 'cancelled'
CREATE TABLE room_bookings (
  booking_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id            INTEGER NOT NULL,
  rent_type          TEXT NOT NULL,
  check_in_date      TEXT NOT NULL,
  check_out_date     TEXT,
  booking_date       TEXT NOT NULL,
  rent_price_cents   INTEGER NOT NULL,
  booking_fee_cents  INTEGER NOT NULL,
  payment_method     TEXT NOT NULL,
  customer_name      TEXT NOT NULL,
  customer_phone     TEXT NOT NULL,
  note               TEXT,
  status             TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms (room_id)
);
CREATE INDEX idx_room_bookings_room ON room_bookings (room_id);

-- -----------------------------------------------------
-- contract_terminations (1:1 with contracts)
-- -----------------------------------------------------
-- status allowed: 'draft' | 'completed' | 'cancelled'
CREATE TABLE contract_terminations (
  termination_id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id                        INTEGER NOT NULL UNIQUE,
  notice_date                        TEXT NOT NULL,
  actual_move_out_date               TEXT NOT NULL,
  deposit_snapshot_cents             INTEGER NOT NULL,
  unpaid_invoices_total_cents        INTEGER NOT NULL,
  additional_adjustments_total_cents INTEGER NOT NULL,
  net_refund_amount_cents            INTEGER NOT NULL,
  status                             TEXT NOT NULL,
  created_at                         TEXT NOT NULL,
  updated_at                         TEXT,
  FOREIGN KEY (contract_id) REFERENCES contracts (contract_id)
);
CREATE INDEX idx_contract_terminations_contract ON contract_terminations (contract_id);

-- -----------------------------------------------------
-- contract_termination_items
-- -----------------------------------------------------
-- item_type allowed: 'service' | 'discount_refund' | 'water' | 'electricity'
CREATE TABLE contract_termination_items (
  item_id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_termination_id  INTEGER NOT NULL,
  item_type                TEXT,
  description              TEXT,
  amount_before_vat_cents  INTEGER,
  vat_percent              DECIMAL(5,2),
  vat_amount_cents         INTEGER,
  total_amount_cents       INTEGER NOT NULL,
  created_at               TEXT NOT NULL,
  FOREIGN KEY (contract_termination_id) REFERENCES contract_terminations (termination_id)
);
CREATE INDEX idx_termination_items_termination ON contract_termination_items (contract_termination_id);

-- -----------------------------------------------------
-- maintenance_requests
-- -----------------------------------------------------
-- status allowed: 'pending' | 'completed' | 'cancelled'
-- NOTE(review): original MySQL marked repaired_date / repair_cost_cents / repair_details
-- as NOT NULL, but these are unknown while a request is still 'pending'. Made nullable
-- here so a pending request can be inserted. Revisit if that was intentional.
CREATE TABLE maintenance_requests (
  maintenance_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id           INTEGER NOT NULL,
  reported_date     TEXT NOT NULL,
  appointment_date  TEXT NOT NULL,
  status            TEXT NOT NULL,
  description       TEXT NOT NULL,
  image_url         TEXT,
  repaired_date     TEXT,
  repair_cost_cents INTEGER,
  repair_details    TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms (room_id)
);
CREATE INDEX idx_maintenance_room ON maintenance_requests (room_id);

-- -----------------------------------------------------
-- meter_batches
-- -----------------------------------------------------
CREATE TABLE meter_batches (
  batch_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  apartment_id  INTEGER NOT NULL,
  reading_date  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT,
  FOREIGN KEY (apartment_id) REFERENCES apartments (apartment_id)
);
CREATE INDEX idx_meter_batches_apartment ON meter_batches (apartment_id);

-- -----------------------------------------------------
-- meter_readings
-- -----------------------------------------------------
CREATE TABLE meter_readings (
  meter_reading_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  meter_batch_id            INTEGER NOT NULL,
  room_id                   INTEGER NOT NULL,
  water_previous_reading    DECIMAL(10,2) NOT NULL,
  water_current_reading     DECIMAL(10,2) NOT NULL,
  water_units_used          DECIMAL(10,2) NOT NULL,
  is_water_over_cycle       INTEGER,
  electric_previous_reading DECIMAL(10,2) NOT NULL,
  electric_current_reading  DECIMAL(10,2) NOT NULL,
  electric_units_used       DECIMAL(10,2) NOT NULL,
  is_electric_over_cycle    INTEGER,
  created_at                TEXT NOT NULL,
  updated_at                TEXT,
  FOREIGN KEY (meter_batch_id) REFERENCES meter_batches (batch_id),
  FOREIGN KEY (room_id) REFERENCES rooms (room_id)
);
CREATE INDEX idx_meter_readings_batch ON meter_readings (meter_batch_id);
CREATE INDEX idx_meter_readings_room ON meter_readings (room_id);

-- -----------------------------------------------------
-- invoices
-- -----------------------------------------------------
-- status allowed: 'unpaid' | 'partial_paid' | 'paid' | 'cancelled'
-- billing_month format: 'YYYY-MM'
CREATE TABLE invoices (
  invoice_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id          INTEGER NOT NULL,
  invoice_number       TEXT NOT NULL,
  billing_month        TEXT NOT NULL,
  issue_date           TEXT NOT NULL,
  due_date             TEXT NOT NULL,
  status               TEXT NOT NULL,
  exempt_amount_cents  INTEGER NOT NULL,
  taxable_amount_cents INTEGER NOT NULL,
  vat_amount_cents     INTEGER NOT NULL,
  total_amount_cents   INTEGER NOT NULL,
  note                 TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT,
  FOREIGN KEY (contract_id) REFERENCES contracts (contract_id)
);
CREATE INDEX idx_invoices_contract ON invoices (contract_id);

-- -----------------------------------------------------
-- invoice_items
-- -----------------------------------------------------
-- item_type allowed: 'rent' | 'water' | 'electricity' | 'service' | 'discount' | 'other'
CREATE TABLE invoice_items (
  invoice_item_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id         INTEGER NOT NULL,
  item_type          TEXT NOT NULL,
  description        TEXT NOT NULL,
  quantity           DECIMAL(10,2) NOT NULL,
  unit_price_cents   INTEGER NOT NULL,
  vat_rate           DECIMAL(5,2) NOT NULL,
  vat_amount_cents   INTEGER NOT NULL,
  total_amount_cents INTEGER NOT NULL,
  created_at         TEXT NOT NULL,
  updated_at         TEXT,
  FOREIGN KEY (invoice_id) REFERENCES invoices (invoice_id)
);
CREATE INDEX idx_invoice_items_invoice ON invoice_items (invoice_id);

-- -----------------------------------------------------
-- payments
-- -----------------------------------------------------
CREATE TABLE payments (
  payment_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by       INTEGER NOT NULL,
  invoice_item_id  INTEGER NOT NULL,
  receipt_number   TEXT NOT NULL,
  payment_date     TEXT NOT NULL,
  amount_cents     INTEGER NOT NULL,
  vat_amount_cents INTEGER NOT NULL,
  payment_method   TEXT NOT NULL,
  remark           TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT,
  FOREIGN KEY (invoice_item_id) REFERENCES invoice_items (invoice_item_id),
  FOREIGN KEY (created_by) REFERENCES users (user_id)
);
CREATE INDEX idx_payments_invoice_item ON payments (invoice_item_id);
CREATE INDEX idx_payments_created_by ON payments (created_by);
