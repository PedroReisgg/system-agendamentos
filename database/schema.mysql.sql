CREATE DATABASE IF NOT EXISTS agenda_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE agenda_dev;

CREATE TABLE IF NOT EXISTS tenants (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(140) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  config_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(140) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  gender ENUM('M', 'F', 'OUTRO') NOT NULL,
  role ENUM('client', 'professional', 'cashier', 'admin') NOT NULL DEFAULT 'client',
  staff_access_level ENUM('viewer', 'manager') NULL DEFAULT NULL,
  job_title VARCHAR(80) NULL,
  email_verified_at TIMESTAMP NULL,
  verification_token VARCHAR(128) NULL UNIQUE,
  favorite_services JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_users_tenant_role (tenant_id, role)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS services (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  name VARCHAR(140) NOT NULL,
  description TEXT NULL,
  price DECIMAL(10, 2) NOT NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_services_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  INDEX idx_services_tenant_active (tenant_id, active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS professionals (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL UNIQUE,
  bio TEXT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_professionals_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_professionals_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_professionals_tenant_active (tenant_id, active)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS professional_services (
  professional_id CHAR(36) NOT NULL,
  service_id CHAR(36) NOT NULL,
  PRIMARY KEY (professional_id, service_id),
  CONSTRAINT fk_ps_professional FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE,
  CONSTRAINT fk_ps_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS working_hours (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  professional_id CHAR(36) NOT NULL,
  day_of_week TINYINT UNSIGNED NOT NULL COMMENT '0=domingo, 1=segunda, ... 6=sábado',
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CONSTRAINT fk_working_hours_professional FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE CASCADE,
  CONSTRAINT chk_working_hours_day CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT chk_working_hours_range CHECK (end_time > start_time),
  UNIQUE KEY uq_working_hours_period (professional_id, day_of_week, start_time, end_time)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS appointments (
  id CHAR(36) NOT NULL PRIMARY KEY,
  tenant_id CHAR(36) NOT NULL,
  client_id CHAR(36) NOT NULL,
  professional_id CHAR(36) NOT NULL,
  service_id CHAR(36) NOT NULL,
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status ENUM('pending', 'confirmed', 'cancelled', 'rescheduled') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_appointments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_appointments_client FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_appointments_professional FOREIGN KEY (professional_id) REFERENCES professionals(id) ON DELETE RESTRICT,
  CONSTRAINT fk_appointments_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT,
  CONSTRAINT chk_appointments_range CHECK (end_time > start_time),
  INDEX idx_appointments_schedule (professional_id, appointment_date, status, start_time, end_time),
  INDEX idx_appointments_client (client_id, appointment_date),
  INDEX idx_appointments_tenant_created (tenant_id, created_at)
) ENGINE=InnoDB;

INSERT IGNORE INTO tenants (id, name, slug, config_json)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Casa Âmbar',
  'casa-ambar',
  JSON_OBJECT(
    'primaryColor', '#713112',
    'accentColor', '#cd966c',
    'backgroundColor', '#ffd7ab',
    'logoUrl', '',
    'address', 'Informe o endereço do seu espaço'
  )
);
