export const tskillSource = "# Customers Skill\n\n## Table Purpose\nManage customer records including contact information and status for a business CRM system.\n\n## Fields\n\n### customer_id\n\n#### Description\nUnique integer identifier for each customer (primary key, auto-increment)\n\n#### PrimaryKey\nAuto-increment starting from 1\n\n#### Field Value Is Required\nAlways required as primary key\n\n### name\n\n#### Description\nFull name of the customer (string, max 200 characters)\n\n#### Aliases\n[\"customer_name\", \"full_name\", \"contact_name\"]\n\n#### Field Value Presenter\nDisplay the name in Title Case format\n\n#### Field Value Resolver\nConvert input to Title Case and trim whitespace\n\n#### Field Value Validator\nMust be between 2 and 200 characters. Cannot contain only numbers or special characters.\n\n#### Field Value Is Required\nAlways required for customer records\n\n### email\n\n#### Description\nEmail address for customer contact (string, unique)\n\n#### Aliases\n[\"email_address\", \"contact_email\"]\n\n#### Field Value Presenter\nDisplay email in lowercase format\n\n#### Field Value Resolver\nConvert to lowercase and trim whitespace\n\n#### Field Value Validator\nMust be a valid email format matching pattern: /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/\n\n#### Field Value Is Required\nAlways required for customer contact\n\n### status\n\n#### Description\nCurrent status of the customer account (enum: active, inactive, pending, suspended)\n\n#### Aliases\n[\"account_status\", \"customer_status\"]\n\n#### Field Value Presenter\nDisplay status in uppercase with color coding context\n\n#### Field Value Resolver\nConvert to lowercase and validate against allowed values\n\n#### Field Value Validator\nMust be one of: active, inactive, pending, suspended\n\n#### Field Value Enumerator\nReturn [\"active\", \"inactive\", \"pending\", \"suspended\"]\n\n#### Field Value Is Required\nDefaults to 'pending' if not specified\n\n### display_name\n\n#### Description\nComputed field combining name and status for display purposes\n\n#### Field Value Derivator\nConcatenate name with status in parentheses. Example: \"John Doe (active)\"\n\n## Business Rules\n\n- Email addresses must be unique across all customer records\n- Customer status can only transition from 'pending' to 'active' or 'inactive'\n- Once suspended, customers cannot be set to 'active' without admin approval\n";

export function presenter_name(value, record) {
    if (!value) return "";
    return value.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

export function presenter_email(value, record) {
    return value ? value.toLowerCase() : 'N/A';
}

export function presenter_status(value, record) {
    if (!value) {
        return 'UNKNOWN STATUS';
    }
    const statusMap = {
        active: 'ACTIVE',
        inactive: 'INACTIVE',
        pending: 'PENDING',
        suspended: 'SUSPENDED'
    };
    const upperStatus = statusMap[value.toLowerCase()];
    return upperStatus || 'INVALID STATUS';
}

export function resolver_name(humanValue, record) {
    if (typeof humanValue !== 'string') return null;
    const trimmedValue = humanValue.trim();
    if (trimmedValue.length === 0) return null;
    return trimmedValue.replace(/\b\w/g, char => char.toUpperCase());
}

export function resolver_email(humanValue, record) {
    if (typeof humanValue === 'undefined' || humanValue === null) {
        return null;
    }
    return humanValue.trim().toLowerCase();
}

export function resolver_status(humanValue, record) {
    if (humanValue === null || humanValue === undefined) {
        return 'pending'; // default status if not specified
    }

    const allowedValues = ['active', 'inactive', 'pending', 'suspended'];
    const lowerCaseValue = humanValue.toLowerCase().trim();

    if (allowedValues.includes(lowerCaseValue)) {
        return lowerCaseValue;
    }

    throw new Error(`Invalid status value: ${humanValue}`);
}

export function validator_customer_id(value, record) {
    if (value === undefined || value === null || value === '') {
        return JSON.stringify({ field: 'customer_id', error: 'Field is required', value });
    }
    if (!Number.isInteger(value) || value <= 0) {
        return JSON.stringify({ field: 'customer_id', error: 'Must be a positive integer', value });
    }
    return '';
}

export function validator_name(value, record) {
    const trimmedValue = value.trim();
    const isValidLength = trimmedValue.length >= 2 && trimmedValue.length <= 200;
    const isNotOnlyNumbersOrSpecialChars = /^(?=.*[A-Za-z])(?=.*\d|.*\W).*$/;

    if (isValidLength && isNotOnlyNumbersOrSpecialChars.test(trimmedValue)) {
        return '';
    } else {
        const error = !isValidLength ? 'Name must be between 2 and 200 characters.' : 'Name cannot contain only numbers or special characters.';
        return JSON.stringify({ field: 'name', error, value });
    }
}

export function validator_email(value, record) {
    const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!value || !pattern.test(value)) {
        return JSON.stringify({ field: 'email', error: 'Invalid email format', value });
    }
    return '';
}

export function validator_status(value, record) {
    const validStatuses = ['active', 'inactive', 'pending', 'suspended'];
    const defaultStatus = 'pending';
    
    if (!value) {
        value = defaultStatus;
    }
    
    if (validStatuses.includes(value)) {
        return '';
    } else {
        return JSON.stringify({field: 'status', error: 'Invalid status', value});
    }
}

export function enumerator_status(currentRecord) {
    return ["active", "inactive", "pending", "suspended"];
}

export async function selectRecords(filter) {
    // Apply filter criteria to select records from customers-dbtable
    // Filter format: { field: value } or { field: { operator: value } }

    // Placeholder implementation - should integrate with database adapter
    const records = [];

    // Apply filter logic here
    if (filter && typeof filter === 'object') {
        // Filter records based on criteria
    }

    return records;
}

export async function prepareRecord(record) {
    const prepared = { ...record };

    // Remove derived/computed fields (they're not stored in DB)
    // No derived fields to remove

    // Apply resolvers to convert human input to database format
    if (prepared.name !== undefined) {
        prepared.name = await resolver_name(prepared.name, record);
    }
    if (prepared.email !== undefined) {
        prepared.email = await resolver_email(prepared.email, record);
    }
    if (prepared.status !== undefined) {
        prepared.status = await resolver_status(prepared.status, record);
    }

    return prepared;
}

export async function validateRecord(record) {
    const errors = [];

    // Run validators for each field
    const customer_idError = await validator_customer_id(record.customer_id, record);
    if (customer_idError) {
        try {
            errors.push(JSON.parse(customer_idError));
        } catch (e) {
            errors.push({
                field: 'customer_id',
                error: customer_idError,
                value: record.customer_id
            });
        }
    }
    const nameError = await validator_name(record.name, record);
    if (nameError) {
        try {
            errors.push(JSON.parse(nameError));
        } catch (e) {
            errors.push({
                field: 'name',
                error: nameError,
                value: record.name
            });
        }
    }
    const emailError = await validator_email(record.email, record);
    if (emailError) {
        try {
            errors.push(JSON.parse(emailError));
        } catch (e) {
            errors.push({
                field: 'email',
                error: emailError,
                value: record.email
            });
        }
    }
    const statusError = await validator_status(record.status, record);
    if (statusError) {
        try {
            errors.push(JSON.parse(statusError));
        } catch (e) {
            errors.push({
                field: 'status',
                error: statusError,
                value: record.status
            });
        }
    }

    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

export async function presentRecord(record) {
    const presented = { ...record };

    // Apply presenters to format values for display
    if (presented.name !== undefined) {
        presented.name = await presenter_name(presented.name, record);
    }
    if (presented.email !== undefined) {
        presented.email = await presenter_email(presented.email, record);
    }
    if (presented.status !== undefined) {
        presented.status = await presenter_status(presented.status, record);
    }

    // Add derived/computed fields
    // No derived fields to add

    return presented;
}

export function generatePKValues(record) {
    // Generate primary key for field: customer_id
    // Strategy: Auto-increment starting from 1

    const pkValue = {
        customer_id: null
    };

    // Auto-increment logic
    // This should query the database for the next available ID
    pkValue.customer_id = Date.now(); // Placeholder - use proper auto-increment

    return pkValue;
}

export const functions = {
    presenters: {
        presenter_name: presenter_name,
        presenter_email: presenter_email,
        presenter_status: presenter_status,
    },
    resolvers: {
        resolver_name: resolver_name,
        resolver_email: resolver_email,
        resolver_status: resolver_status,
    },
    validators: {
        validator_customer_id: validator_customer_id,
        validator_name: validator_name,
        validator_email: validator_email,
        validator_status: validator_status,
    },
    enumerators: {
        enumerator_status: enumerator_status,
    },
    derivators: {
    },
    fieldNamePresenters: {
    },
    global: {
        selectRecords: selectRecords,
        prepareRecord: prepareRecord,
        validateRecord: validateRecord,
        presentRecord: presentRecord,
        generatePKValues: generatePKValues,
    },
};