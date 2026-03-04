// A simple container for shared manager instances

const managers: { [key: string]: any } = {};

export function registerManager(name: string, instance: any) {
  managers[name] = instance;
}

export function getManager<T>(name: string): T {
  const instance = managers[name];
  if (!instance) {
    throw new Error(`Manager '${name}' not found.`);
  }
  return instance as T;
}
