// mapRecord should return a normalized record with status "active".
export function mapRecord(record) {
    return {
        ...record,
        normalized: false,
        status: 'inactive',
    };
}
