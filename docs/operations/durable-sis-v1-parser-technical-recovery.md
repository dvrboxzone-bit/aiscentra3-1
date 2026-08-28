# Durable SIS V1 parser technical recovery

Run this procedure only after the repair migration and application SHA are in
Production, with the Durable SIS control disabled. It preserves the existing
`signal_decision_log` row as append-only audit evidence. It does not bypass or
disable any trigger.

The recovery RPC is generic and fail-closed: it accepts run and decision IDs,
then verifies that they describe a finalized `R-15` provider-chain technical
failure with no Signal, no active attempt, no reserved provider budget, and no
queued message. It records the recovery in `sis_execution_recoveries`, removes
only the operational finalization row, marks the old run `FAILED`, and restores
the observation to an unprocessed retryable state.

Exact one-off invocation for the 2026-08-28 control incident:

```sql
begin;

select public.recover_durable_sis_v1_technical_failure(
  '772de061-89e9-48b0-986c-3606e4069f19'::uuid,
  'ca354cfb-1f3f-4510-8b4b-67090ed67376'::uuid
);

select
  run.status,
  observation.processed,
  observation.signal_id,
  recovery.decision_log_id,
  decision.id as preserved_decision_id
from public.sis_execution_runs run
join public.observations observation on observation.id = run.observation_id
join public.sis_execution_recoveries recovery on recovery.run_id = run.id
join public.signal_decision_log decision on decision.id = recovery.decision_log_id
where run.id = '772de061-89e9-48b0-986c-3606e4069f19'::uuid;

commit;
```

Expected verification row: `status=FAILED`, `processed=false`,
`signal_id=null`, and identical non-null `decision_log_id` /
`preserved_decision_id`. Stop and roll back the transaction if any expectation
does not hold. A later manual control-run remains a separate owner approval.
