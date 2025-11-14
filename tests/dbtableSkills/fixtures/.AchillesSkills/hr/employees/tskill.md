# HR Employees

Maintain employee roster information so agents can reconcile approvals and badge access updates.

## Table Purpose
Expose staff metadata (name, department, manager) for downstream approval workflows. Agents primarily look up employees, update contact info, and derive compliance fields (e.g. badge status).

## Field: employee_id
### Description
Unique staff identifier shared with payroll.
### Field Name Presenter
Employee ID
### Presenter
Display `EMP-` followed by the numeric token.
### Resolver
Strip prefixes such as `emp` or `#` and left-pad to six digits.
### PrimaryKey
If missing, derive from department initials plus a sequence number.
### Indexed
Employee ID is a unique index.

## Field: full_name
### Description
Legal full name for HR records.
### Field Name Presenter
Full Name
### Required
Always required on create.
### Presenter
Title case the name and ensure there is a space between first and last name.
### Resolver
Trim whitespace and collapse repeated spaces.

## Field: preferred_name
### Description
Optional preferred name used in chat or access systems.
### Field Name Presenter
Preferred Name
### Presenter
Return as-is if provided; otherwise return the given name derived from `full_name`.
### Derivator
If `preferred_name` is missing, derive it by taking the first token of `full_name`.

## Field: department
### Description
Department or business unit.
### Field Name Presenter
Department
### Required
Mandatory during onboarding.
### Enumerator
Read options from the current record context: `engineering`, `operations`, `hr`, `finance`, `support`.
### Presenter
Capitalise each word (e.g. `Human Resources`).
### Resolver
Allow synonyms like `ops`, `support center`, or `cust support`.

## Field: manager_id
### Description
Foreign key referencing another employee.
### Field Name Presenter
Manager ID
### Presenter
Display `Manager: <preferred name>` if the manager record is available via Persisto grouping.
### Resolver
Accept values such as email, name, or employee ID and map to the canonical employee ID by querying the `employees` table using `select` instructions.
### Enumerator
When deriving options, filter to employees that share the same department.

## Field: status
### Description
Employment status (active, leave, terminated).
### Field Name Presenter
Status
### Required
Required.
### Enumerator
- active
- leave
- terminated
### Validator
If status is `terminated`, ensure `termination_reason` is present. Respond with JSON describing the missing field otherwise.

## Field: termination_reason
### Description
Optional explanation captured when status becomes terminated.
### Field Name Presenter
Termination Reason
### Presenter
Return the reason in sentence case.

## Field: badge_state
### Description
Derived indicator summarising whether the employee badge should be active.
### Field Name Presenter
Badge State
### Derivator
If status is `active`, set to `ENABLED`. If status is `leave`, set to `SUSPENDED`. If status is `terminated`, set to `REVOKED`.
