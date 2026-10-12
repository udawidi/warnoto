# Research: TUG MARA Posting Guard

## Decisions

- **Enforcement boundary**: Database RPC. Client checks improve UX but cannot authorize posting.
- **TUG-3 normal**: Replace browser-side stock mutation with one atomic, idempotent final-approval RPC.
- **TUG-3 MTU**: Extend the existing receipt RPC instead of creating a parallel workflow.
- **TUG-10**: Extend the existing atomic final-approval RPC without changing its public signature.
- **Code matching**: `ltrim(btrim(code), '0')`; zero or multiple matches fail closed.
- **Authoritative fields**: MARA supplies code, name, unit, and category. Matching Master Katalog rows are synchronized during final approval.
- **Compatibility**: Pending legacy documents remain editable; approved history is untouched.

## Alternatives Rejected

- Client-only validation: bypassable and cannot guarantee atomic rollback.
- Global stock trigger for every write: wider blast radius than the requested TUG flows.
- Trusting existing Master Katalog without MARA lookup: preserves the reported data-integrity gap.
