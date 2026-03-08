export class ResourceNotFoundError extends Error {
    constructor(resourceType, resourceId) {
        super(`${resourceType} with ID '${resourceId}' not found.`);
        this.name = 'ResourceNotFoundError';
    }
}
