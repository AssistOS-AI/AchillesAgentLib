# DS Structure Profile

## Vision and Problem Statement
We need reliable storage and lookup for equipment, materials, and jobs so the UI can list them, filter them, and keep ids unique. Without consistent storage, availability rules and job assignments cannot be trusted.

## Intended Users and Context of Use
Used by list views, search and filter panels, and the job assignment workflow.

## Scope and Boundaries
Local persistence only with deterministic id generation and lookup behavior. No distributed storage, external databases, or cross-tenant concerns.

## Success Criteria
- Unique ids are enforced for equipment, materials, and jobs.
- Lists load quickly with predictable ordering.
- Read/write operations are deterministic and easy to audit.

## Pointers to Supporting DS Files
- DS_auth.md for catalog responsibilities.
- DS_jobs.md for assignment flows.
- DS_metrics.md for search and filter needs.

## Affected Files
./specs/catalog/EquipmentCatalog.mjs.md - Defines storage and lookup for equipment items.  
Exports - EquipmentCatalog, EquipmentStoreAdapter.

./specs/catalog/MaterialCatalog.mjs.md - Defines storage and lookup for material items and quantities.  
Exports - MaterialCatalog, MaterialStoreAdapter.
