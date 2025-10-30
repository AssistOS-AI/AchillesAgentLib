# Assign Inventory Transfer

Translate warehouse and SKU display names to their internal identifiers while coordinating an
inventory transfer between locations.

## Required Inputs

- Source warehouse ID
- Destination warehouse ID
- SKU ID
- Quantity to move

## Behaviour

- Loads human-friendly labels from a fixture file.
- Presents readable labels during the conversation.
- Invokes downstream logic with the canonical identifiers.
