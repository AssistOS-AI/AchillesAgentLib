# Projects

Track internal initiatives and their lifecycle status.

## Table Purpose
Provide lifecycle visibility by allowing the agent to list, create, or update projects and explain their business status.

## Field: project_id
### Description
Unique identifier for the project record.
### Aliases
- id
- project code
- ticket
### Field Name Presenter
Project ID
### Presenter
Return the human readable project identifier exactly as stored. Use uppercase letters and keep the PRJ- prefix.
### Resolver
Accept input like `PRJ-1`, `Project 1`, or `project_id=1` and normalise it to the canonical `PRJ-XXX` format with leading zeroes when needed.
### PrimaryKey
If not provided, generate a value with the prefix `PRJ-` followed by a padded counter.
### Indexed
The column is indexed to keep lookups fast.

## Field: name
### Description
Official project name presented to stakeholders.
### Field Name Presenter
Project Name
### Required
Always required before saving a record.
### Presenter
Return the project name unchanged.
### Resolver
Trim whitespace and collapse duplicate spaces. Title case the value.

## Field: status
### Description
Lifecycle status that indicates delivery progress.
### Field Name Presenter
Status
### Required
Status is mandatory whenever a project is created or updated.
### Enumerator
- planned: scheduled but not started
- active: currently being worked on
- complete: fully delivered
### Presenter
Return the friendly label (Planned, Active, Complete) instead of lower-case tokens.
### Resolver
Map synonyms (planned, scheduling, backlog -> planned; active, in flight, running -> active; complete, finished, done -> complete).
### Validator
Reject any value that is not one of planned, active, or complete. Return a JSON body describing the invalid field.
