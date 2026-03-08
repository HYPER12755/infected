// A simple container for shared manager instances
const managers = {};
export function registerManager(name, instance) {
    managers[name] = instance;
}
export function getManager(name) {
    const instance = managers[name];
    if (!instance) {
        throw new Error(`Manager '${name}' not found.`);
    }
    return instance;
}
