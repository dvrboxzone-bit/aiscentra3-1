-- ============================================================
-- Migration: 20260728000001_signal_v2_enums
-- Signal Engine V2 — New status values
-- ============================================================

ALTER TYPE signal_status ADD VALUE IF NOT EXISTS 'WEAK'    AFTER 'DRAFT';
ALTER TYPE signal_status ADD VALUE IF NOT EXISTS 'DORMANT' AFTER 'EXPIRED';

-- Verification:
-- SELECT enum_range(NULL::signal_status);
-- Expected: CANDIDATE, DRAFT, WEAK, ACTIVE, PROMOTED, EXPIRED, DORMANT, REJECTED
