# Support Incidents

Centralise warehouse and corporate ticket handling so agents can triage issues using natural language requests.

## Table Purpose
Each record tracks a single incident raised by staff. Agents must be able to fetch ticket status summaries, update ownership, or create a new ticket when a printer or dock device fails.

## Field: incident_id
### Description
Primary identifier for the support ticket used across tracking systems.
### Field Name Presenter
Incident ID
### Presenter
Display the identifier in the shape `INC-XXXX`. If the stored value contains digits only, prefix it with `INC-` and left-pad to four digits.
### Resolver
Normalise any token such as `inc45`, `INC-0045`, or `ticket 45` into the canonical `INC-0045` form.
### PrimaryKey
Auto-generate sequential IDs that keep the `INC-` prefix and increment the numeric counter.
### Indexed
Indexed for quick lookups.

## Field: summary
### Description
Short human-readable subject describing the incident.
### Field Name Presenter
Incident Summary
### Required
Always required when creating a ticket.
### Presenter
Return the text with each sentence capitalised. Limit to 80 characters when displaying.
### Resolver
Trim whitespace, collapse repeated punctuation, and ensure the first letter is uppercase.

## Field: priority
### Description
Business urgency of the ticket. Determines SLA targets.
### Field Name Presenter
Priority
### Required
Mandatory on create; optional on update unless value changes.
### Enumerator
- Critical: production outage or safety issue.
- High: severe degradation.
- Normal: standard request.
- Low: minor cosmetic problem.
### Presenter
Return `Critical`, `High`, `Normal`, or `Low` depending on the stored token.
### Resolver
Map synonyms such as `sev1`, `P1`, or `urgent` to `critical`; `P2` to `high`; `standard` to `normal`; `minor` to `low`.
### Validator
Reject any priority not in the enumerated list and explain that only the mapped values are allowed.

## Field: assigned_team
### Description
Operational group that owns follow-up.
### Field Name Presenter
Assigned Team
### Aliases
- owner
- team
- oncall group
### Required
Required when the incident status is `in_progress`.
### Enumerator
Load available teams from the incident record context: `warehouse-ops`, `networking`, `corporate-it`, `field-services`.
### Presenter
Return the display name with spaces, e.g. `Warehouse Ops`.
### Resolver
Accept inputs like `warehouse ops`, `WarehouseOps`, or `WH OPS` and map to `warehouse-ops`.
### Grouping
Groupname: SupportTeams

## Field: status
### Description
Lifecycle state for the incident.
### Field Name Presenter
Status
### Required
Always required.
### Enumerator
- new: ticket logged and awaiting triage.
- in_progress: work is in flight.
- pending_external: waiting on a vendor or partner.
- resolved: fix confirmed.
### Presenter
Show friendly text such as `Pending External Response`.
### Validator
If status is `resolved`, ensure there is a resolution note stored in the `derived_resolution_note` field.

## Field: resolution_summary
### Description
Optional free text explaining how the incident was fixed.
### Field Name Presenter
Resolution Summary
### Presenter
Display the raw text as a paragraph.
### Resolver
Trim whitespace and remove redundant line breaks.

## Field: derived_resolution_note
### Description
Virtual field summarising any notes when an incident is resolved.
### Field Name Presenter
Resolution Note
### Derivator
If `status` is `resolved` and the record contains `resolution_summary`, surface that text. Otherwise leave empty. This is a fake field calculated at presentation time.
