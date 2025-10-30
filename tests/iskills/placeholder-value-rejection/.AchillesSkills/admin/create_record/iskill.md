# Create Record

Create a new administrative record only when the provided values look legitimate, rejecting common
placeholder terms like “not provided”.

## Required Inputs

- Record name
- Record type

## Validation

- Detects placeholder strings that often leak from templates.
- Continues prompting until genuine values are supplied.
- Executes once all inputs pass validation.
