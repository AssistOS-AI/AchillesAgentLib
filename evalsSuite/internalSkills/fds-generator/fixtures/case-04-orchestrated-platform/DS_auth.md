# DS Structure Profile

## Vision and Problem Statement
We need a web app that manages equipment and materials, assigns them to jobs, and keeps availability accurate while jobs are active. When a job runs for 1-14 days, the assigned items cannot be used by other jobs. Without a structured catalog, teams lose track of ids, quantities, and availability and the job schedule breaks down.

The intended future state is a single source of truth for equipment and materials with consistent ids, list views, and availability flags that update when jobs start or end. This is the foundation for job assignment and search workflows.

## Intended Users and Context of Use
Dispatchers, coordinators, and operations staff manage inventory from a browser and need quick visibility into what is available. They also need to edit and reference unique ids while assigning items to jobs.

## Scope and Boundaries
This DS covers the catalog of equipment and materials, including unique ids, list views, and availability flags. It does not cover authentication, billing, or external ERP integrations. It also does not define job lifecycle logic beyond the availability impact that jobs impose on items.

## Success Criteria
- Each equipment and material record has a unique id and a stable representation.
- Lists of equipment and materials can be rendered consistently and filtered by availability.
- Availability flags update correctly when jobs start or end.

## Pointers to Supporting DS Files
- DS_jobs.md for job lifecycle and assignment rules.
- DS_storage.md for persistence and lookup behavior.
- DS_metrics.md for search and filter UI expectations.

## Affected Files
./specs/catalog/EquipmentCatalog.mjs.md - Defines the canonical equipment catalog, ids, and availability flags.  
Exports - EquipmentRecord, EquipmentCatalog, EquipmentAvailability.

./specs/catalog/MaterialCatalog.mjs.md - Defines the material catalog, quantities, and availability flags.  
Exports - MaterialRecord, MaterialCatalog, MaterialAvailability.
