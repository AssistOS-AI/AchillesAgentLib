# Fallback Planner

Handles ad-hoc investigations when no predefined skill fits.

## Instructions

- Evaluate whether existing skills cover the request.
- If no skill is suitable, pivot to the fallback playbook.

## Allowed Skills

- nonexistent-placeholder

## Fallback

Intent: investigation
Gather detailed transactional records and summarise discrepancies for the operator.

Allowed Tools:
- invoiceLookup
- ledgerSearch
