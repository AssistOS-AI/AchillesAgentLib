class PersistoClient {
    constructor(serverUrl) {
        this.serverUrl = serverUrl;
    }

    async #getRequest(path) {
        const url = `${this.serverUrl}${path}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Request failed with status ${response.status}: ${errorData.message || 'Unknown server error'}`);
        }

        const responseData = await response.json();
        if (responseData.success) {
            return responseData.result;
        }
        return responseData.hasOwnProperty('result') ? responseData.result : null;
    }

    async #postRequest(path, data) {
        const url = `${this.serverUrl}${path}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Request failed with status ${response.status}: ${errorData.error || 'Unknown server error'}`);
        }

        const responseData = await response.json();
        if (responseData.success) {
            return responseData.result;
        }
        // Return null or undefined if there's no specific result but the call was successful
        return responseData.hasOwnProperty('result') ? responseData.result : null;
    }

    async getAllMethods() {
        return this.#getRequest('/getAllMethods');
    }

    async addModel(config) {
        return this.#postRequest('/addModel', config);
    }

    async addType(config) {
        return this.#postRequest('/addType', config);
    }

    async updateModel(config) {
        return this.#postRequest('/updateModel', config);
    }

    async updateType(config) {
        return this.#postRequest('/updateType', config);
    }

    async addAsset(config) {
        return this.#postRequest('/addAsset', config);
    }

    async updateAsset(config) {
        return this.#postRequest('/updateAsset', config);
    }

    async execute(command, ...args) {
        return this.#postRequest(`/${command}`, args);
    }
}

export default PersistoClient;