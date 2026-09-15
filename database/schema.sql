CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE gender_type AS ENUM ('M', 'F', 'OUTRO');
CREATE TYPE user_role AS ENUM ('client', 'professional', 'admin');
CREATE TYPE appointment_status AS ENUM ('pending', 'confirmed', 'cancelled', 'rescheduled');

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(140) NOT NULL,
  slug VARCHAR(80) NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(140) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  phone VARCHAR(16) NOT NULL CHECK (phone ~ '^\\+[1-9][0-9]{7,14}$'),
  gender gender_type NOT NULL,
  role user_role NOT NULL DEFAULT 'client',
  email_verified_at TIMESTAMPTZ,
  verification_token VARCHAR(128) UNIQUE,
  favorite_services JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(140) NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 5 AND 1440),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE professionals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  bio TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (id, tenant_id)
);

CREATE TABLE professional_services (
  professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (professional_id, service_id)
);

CREATE TABLE working_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CHECK (end_time > start_time),
  UNIQUE (professional_id, day_of_week, start_time, end_time)
);

CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES users(id),
  professional_id UUID NOT NULL REFERENCES professionals(id),
  service_id UUID NOT NULL REFERENCES services(id),
  appointment_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status appointment_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE INDEX appointments_professional_date_idx ON appointments (professional_id, appointment_date, start_time);
CREATE INDEX appointments_client_date_idx ON appointments (client_id, appointment_date DESC);
CREATE INDEX services_tenant_idx ON services (tenant_id) WHERE active;
CREATE INDEX users_tenant_role_idx ON users (tenant_id, role);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON appointments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Seed opcional para desenvolvimento.
INSERT INTO tenants (name, slug, config_json) VALUES
('Capelli Rudge Ramos', 'capelli-demo', '{"primary":"#8A6038","surface":"#FFFFFF","logoText":"Capelli","address":"Rua de exemplo, 100 — São Paulo, SP","hours":"Terça a sexta · 09h às 20h\\nSábado · 09h às 18h","mapsEmbedUrl":"https://www.google.com/maps?q=Rua%20de%20exemplo%2C%20100%2C%20Sao%20Paulo%2C%20SP&output=embed"}')
ON CONFLICT (slug) DO NOTHING;
