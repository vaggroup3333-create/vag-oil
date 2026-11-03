# VAG Oil backups

Use the Site's connected owner-only tools. Routine runs do not publish code.

1. Call `create_daily_backup` once. It is idempotent for the Asia/Dushanbe date.
2. Call `verify_backup` with the returned ID. It reads back the manifest and checks every copied photo by SHA-256.
3. Call `backup_status` to confirm the saved copy is visible. Report a failure or a missing/corrupt photo; never report a partial copy as success. A transient failure can be retried once with the same daily operation.

Keep successful copies for 30 days. Cleanup applies only to completed backup directories older than 30 days, after verifying a successful new copy. Never delete original photos or change live ledgers. Missing photos fail the backup.

The owner identity is verified by Sites and checked against the configured owner email on the server. No password, service token or login session belongs in the task prompt. If the app connection needs consent, stop and request reconnection. The tool does not expose business records in its responses.

After an actual Sites schedule has been created, call `record_backup_schedule` with its returned automation ID. This records configuration for display, not proof that a scheduled run happened. `backup_status` shows the last successful copy independently.

## Coverage and recovery

Private R2 directory: `ledger-backups/<encoded ledger owner>/<backup ID>/`. The `manifest.json` commit marker is written after referenced photos are copied and verified. It contains unmodified JSON strings and version numbers for both ledgers plus cashier sync receipts/reset markers from the same transactional D1 read. Snapshot photo paths, size and checksum are included.

The archive excludes passwords, sessions, unsubmitted/offline device operations and code. Source code is versioned separately. Backups share the application's storage account; they are not protection against deletion of the entire hosting account. Keep exported copies separately too.

Recovery must be tested in an isolated database/bucket before touching production. Import every ledger row with its original ID/data/version and sync receipt/reset rows; copy each photo to its manifest `source` path, then compare bytes/checksums and ledger JSON. Restoring a production snapshot requires stopping writers and resolving later offline operations with the owner; no production restore tool is exposed.
