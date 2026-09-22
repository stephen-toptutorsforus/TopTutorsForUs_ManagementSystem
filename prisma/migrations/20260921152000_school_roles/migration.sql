-- School-scoped authority. Super admin stays `admin` (organization-wide).
-- These two are a deliberate break from the Python enum, which has neither.
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'school_admin';
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'principal';
