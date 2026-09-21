const DESTINATION_TYPES = new Set(['child', 'parent']);

function required(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`);
  return value.trim();
}

function routeKey(familyId, destinationType, destinationKey) {
  return `${familyId}\u0000${destinationType}\u0000${destinationKey}`;
}

/**
 * Build an immutable lookup for trusted Discord bindings.
 *
 * Model/tool input must carry logical destinationKey values. Raw provider ids
 * are only accepted while provisioning the binding and are never used as a
 * model-facing lookup key.
 */
export function createRouteIndex(families) {
  if (!Array.isArray(families) || families.length === 0) throw new Error('families must be a non-empty array');
  const byRoute = new Map();
  const familyIds = new Set();

  for (const family of families) {
    const familyId = required(family?.familyId, 'familyId');
    if (familyIds.has(familyId)) throw new Error(`duplicate familyId: ${familyId}`);
    familyIds.add(familyId);
    const children = family.children;
    if (!Array.isArray(children) || children.length === 0) throw new Error(`family ${familyId} must have children`);
    const childIds = new Set();

    const add = (destinationType, destination, childId = null) => {
      if (!DESTINATION_TYPES.has(destinationType)) throw new Error(`unsupported destination type: ${destinationType}`);
      const destinationKey = required(destination?.key, `${destinationType} destination key`);
      const providerId = required(destination?.providerId, `${destinationType} providerId`);
      const key = routeKey(familyId, destinationType, destinationKey);
      if (byRoute.has(key)) throw new Error(`duplicate destination key: ${familyId}/${destinationType}/${destinationKey}`);
      byRoute.set(key, Object.freeze({ familyId, destinationType, destinationKey, providerId, childId }));
    };

    add('parent', family.parent);
    for (const child of children) {
      const childId = required(child?.childId, 'childId');
      if (childIds.has(childId)) throw new Error(`duplicate childId in family ${familyId}: ${childId}`);
      childIds.add(childId);
      add('child', child.destination, childId);
    }
  }

  return Object.freeze({
    resolve({ familyId, destinationType, destinationKey }) {
      const normalizedFamily = required(familyId, 'familyId');
      if (!DESTINATION_TYPES.has(destinationType)) throw new Error(`unsupported destination type: ${destinationType}`);
      const normalizedKey = required(destinationKey, 'destinationKey');
      const result = byRoute.get(routeKey(normalizedFamily, destinationType, normalizedKey));
      if (!result) throw new Error('destination is not bound for this family');
      return result;
    },
    listFamily(familyId) {
      const normalizedFamily = required(familyId, 'familyId');
      return Object.freeze([...byRoute.values()].filter(route => route.familyId === normalizedFamily));
    },
  });
}

export function assertLogicalTarget(target) {
  const familyId = required(target?.familyId, 'familyId');
  const childId = required(target?.childId, 'childId');
  if (target.providerChannelId !== undefined) throw new Error('raw provider channel ids are not valid model targets');
  return Object.freeze({ familyId, childId });
}
