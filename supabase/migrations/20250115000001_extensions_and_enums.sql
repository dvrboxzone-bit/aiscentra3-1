-- ============================================================
-- AIscentra Migration 001
-- Extensions and Enum Types
-- Reference: System Blueprint v1.0, Signal Scoring Specification v1.0
-- ============================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- Enable full-text search
create extension if not exists "pg_trgm";

-- ── Signal Status Enum ────────────────────────────────────────
-- Signal Scoring Specification v1.0, Section 02
-- Terminal states: PROMOTED, EXPIRED, REJECTED — no reversal permitted
create type signal_status as enum (
  'CANDIDATE',
  'DRAFT',
  'ACTIVE',
  'PROMOTED',
  'EXPIRED',
  'REJECTED'
);

-- ── Signal Category Enum ──────────────────────────────────────
-- Signal Scoring Specification v1.0, Section 04
-- These are the ONLY valid categories for MVP
create type signal_category as enum (
  'RESEARCH',
  'MODELS',
  'COMPANIES',
  'INFRASTRUCTURE',
  'OPEN_SOURCE',
  'FUNDING',
  'REGULATION',
  'AGENTS',
  'HARDWARE'
);

-- ── Event Type Enum ───────────────────────────────────────────
-- Intelligence Systems Analyst Skill v1.0, Section 04
create type event_type as enum (
  'LAUNCH',
  'PARTNERSHIP',
  'RESEARCH_BREAKTHROUGH',
  'FUNDING',
  'ACQUISITION',
  'INFRASTRUCTURE_CHANGE',
  'REGULATORY_DEVELOPMENT',
  'STRATEGIC_SHIFT'
);

-- ── Report Type Enum ──────────────────────────────────────────
-- MVP Specification v1.0
create type report_type as enum (
  'SIGNAL_BRIEF',
  'EVENT_ANALYSIS',
  'WEEKLY_REVIEW',
  'TREND_REPORT'
);

-- ── Entity Type Enum ──────────────────────────────────────────
-- System Blueprint v1.0, Entity Model section
create type entity_type as enum (
  'COMPANY',
  'MODEL',
  'RESEARCH_PAPER',
  'PERSON',
  'PRODUCT',
  'AGENT',
  'ORGANIZATION',
  'TECHNOLOGY',
  'INFRASTRUCTURE',
  'REGULATION',
  'INVESTMENT',
  'DATASET',
  'TOOL'
);

-- ── Forecast Outcome Enum ─────────────────────────────────────
-- Intelligence Evolution Framework v1.0, Section 04
create type forecast_outcome as enum (
  'UNRESOLVED',
  'CONFIRMED',
  'PARTIALLY_CONFIRMED',
  'CONTRADICTED'
);

-- ── Source Status Enum ────────────────────────────────────────
create type source_status as enum (
  'ACTIVE',
  'INACTIVE',
  'ERROR'
);
