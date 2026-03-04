export class ResourceNotFoundError extends Error {
  constructor(resourceType: string, resourceId: string) {
    super(`${resourceType} with ID '${resourceId}' not found.`);
    this.name = 'ResourceNotFoundError';
  }
}
