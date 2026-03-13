# JSON Validation Rules

- has_name: The root object must have a "name" field (string, non-empty)
- has_version: The root object must have a "version" field (string matching semver pattern like "1.0.0")
- has_entries: The root object must have an "entries" field (array with at least one element)
- entries_have_id: Every element in "entries" must have an "id" field (number)
- entries_have_label: Every element in "entries" must have a "label" field (string, non-empty)
