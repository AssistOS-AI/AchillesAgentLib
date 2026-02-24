import { openConnection } from './db/connection.mjs';
import { buildInsert, buildSelectAll } from './db/queries.mjs';

export class UserAdapter {
    constructor() {
        this.connection = openConnection();
    }

    addUser(user) {
        const query = buildInsert('users', user);
        return this.connection.insert(query.table, query.record);
    }

    listUsers() {
        const query = buildSelectAll('users');
        return this.connection.findAll(query.table);
    }

    reset() {
        this.connection.clear('users');
    }
}
