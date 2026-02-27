# DS Structure Profile

## Vision and Problem Statement
Jobs are the mechanism that reserve equipment and materials for real work. We need job creation, assignment, and lifecycle control so that a job can be created, started, and closed while keeping items unavailable during the active window. The job duration is 1-14 days and assignments include equipment, materials, and people names.

## Intended Users and Context of Use
Planners create jobs with a schedule and assign the required items and people. Dispatchers need to start jobs and close them when work ends, without breaking availability rules.

## Scope and Boundaries
This DS covers job creation, assignment, start, and end actions. It does not define UI components, authentication, or advanced scheduling like recurring jobs. It assumes single-tenant, single-workspace behavior.

## Success Criteria
- Jobs can be created with unique ids and a 1-14 day duration.
- Jobs can be started and closed with clear status transitions.
- Equipment and materials assigned to active jobs are unavailable for other jobs.
- Assigned people are captured as a list of names per job.

## Pointers to Supporting DS Files
- DS_auth.md for catalog and availability rules.
- DS_storage.md for persistence and lookup.
- DS_metrics.md for search and filter behavior.

## Affected Files
./specs/jobs/JobAssignmentService.mjs.md - Defines job creation, assignment, start/end transitions, and validation.  
Exports - JobRecord, JobAssignmentService, JobStatusTransition.

./specs/jobs/AvailabilityIndex.mjs.md - Defines availability derivation for jobs, equipment, and materials.  
Exports - AvailabilityIndex, AvailabilitySnapshot, AvailabilityQuery.
