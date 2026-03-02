# DS Structure Profile

## Vision and Problem Statement
Users need a unified view that lists equipment, materials, and jobs in one place with a search bar and filters. The filters must support availability for all items, ongoing status for jobs, and quantity ranges for materials. Without this, resource planning is slow and error-prone.

## Intended Users and Context of Use
Dispatchers and planners use the list view to find available items and monitor active jobs throughout the day.

## Scope and Boundaries
This DS covers search and filter behavior for list views. It does not define UI styling, access control, or analytics dashboards.

## Success Criteria
- Search returns items and jobs when the query matches names or ids.
- Availability filters hide items assigned to active jobs.
- Job filters can show only ongoing jobs.
- Material filters can constrain by quantity thresholds.

## Affected Files
./specs/ui/SearchAndFilterPanel.mjs.md - Defines search and filter logic for list views across equipment, materials, and jobs.  
Exports - SearchIndex, FilterState, SearchAndFilterPanel.
