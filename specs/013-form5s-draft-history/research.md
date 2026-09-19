# Research

## Draft persistence

- **Decision:** server-side owner-only row per user and UPT.
- **Rationale:** survives device changes and meets current self-host persistence expectations.
- **Alternatives:** localStorage rejected because it is device-local and not an access-control boundary.

## Photo handling

- **Decision:** reuse existing upload and retain only protected photo metadata in the draft.
- **Rationale:** minimum change; no new endpoint or duplicate storage flow.
- **Limit:** abandoned uploaded photos may remain orphaned; cleanup is excluded to avoid accidental evidence deletion.

## History disclosure

- **Decision:** render summary rows by default and lazy-mount explicit detail.
- **Rationale:** keeps PDF visible and prevents unnecessary protected photo downloads.
