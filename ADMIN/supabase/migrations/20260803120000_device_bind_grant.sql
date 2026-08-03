-- One-shot grant that authorizes a single hardware binding.
-- Issued when an activation code is consumed and cleared the moment an
-- installation binds, so device registration no longer has to infer "this
-- session came from an activation code" from the session's AMR claims.

alter table licensing.members
  add column if not exists device_bind_not_before timestamptz,
  add column if not exists device_bind_expires_at timestamptz;

comment on column licensing.members.device_bind_not_before is
  'Instant the device bind grant was issued; only a session signed in at or after it may register hardware.';

comment on column licensing.members.device_bind_expires_at is
  'Expiry of the device bind grant. Both columns are cleared as soon as an installation binds, so the grant is single use.';
