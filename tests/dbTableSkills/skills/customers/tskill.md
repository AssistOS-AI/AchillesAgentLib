# Customers Skill

## Table Purpose
Manage customer records including contact information and status for a business CRM system.

## Fields

### customer_id

#### Description
Unique integer identifier for each customer (primary key, auto-increment)

#### PrimaryKey
Auto-increment starting from 1

#### Field Value Is Required
Always required as primary key

### name

#### Description
Full name of the customer (string, max 200 characters)

#### Aliases
["customer_name", "full_name", "contact_name"]

#### Field Value Presenter
Display the name in Title Case format

#### Field Value Resolver
Convert input to Title Case and trim whitespace

#### Field Value Validator
Must be between 2 and 200 characters. Cannot contain only numbers or special characters.

#### Field Value Is Required
Always required for customer records

### email

#### Description
Email address for customer contact (string, unique)

#### Aliases
["email_address", "contact_email"]

#### Field Value Presenter
Display email in lowercase format

#### Field Value Resolver
Convert to lowercase and trim whitespace

#### Field Value Validator
Must be a valid email format matching pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/

#### Field Value Is Required
Always required for customer contact

### status

#### Description
Current status of the customer account (enum: active, inactive, pending, suspended)

#### Aliases
["account_status", "customer_status"]

#### Field Value Presenter
Display status in uppercase with color coding context

#### Field Value Resolver
Convert to lowercase and validate against allowed values

#### Field Value Validator
Must be one of: active, inactive, pending, suspended

#### Field Value Enumerator
Return ["active", "inactive", "pending", "suspended"]

#### Field Value Is Required
Defaults to 'pending' if not specified

### display_name

#### Description
Computed field combining name and status for display purposes

#### Field Value Derivator
Concatenate name with status in parentheses. Example: "John Doe (active)"

## Business Rules

- Email addresses must be unique across all customer records
- Customer status can only transition from 'pending' to 'active' or 'inactive'
- Once suspended, customers cannot be set to 'active' without admin approval
