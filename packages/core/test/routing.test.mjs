import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLogicalTarget, createRouteIndex } from '../src/routing.mjs';

const families = [{
  familyId: 'family-a',
  parent: { key: 'parent', providerId: 'discord-parent-a' },
  children: [
    { childId: 'alex', destination: { key: 'alex', providerId: 'discord-alex-a' } },
  ],
}, {
  familyId: 'family-b',
  parent: { key: 'parent', providerId: 'discord-parent-b' },
  children: [
    { childId: 'sam', destination: { key: 'sam', providerId: 'discord-sam-b' } },
  ],
}];

test('resolves provider bindings only within the authenticated family', () => {
  const routes = createRouteIndex(families);
  assert.deepEqual(routes.resolve({ familyId: 'family-a', destinationType: 'child', destinationKey: 'alex' }), {
    familyId: 'family-a', destinationType: 'child', destinationKey: 'alex', providerId: 'discord-alex-a', childId: 'alex',
  });
  assert.throws(() => routes.resolve({ familyId: 'family-a', destinationType: 'child', destinationKey: 'sam' }), /not bound/);
  assert.equal(routes.listFamily('family-b').length, 2);
});

test('rejects duplicate bindings and raw provider ids as model targets', () => {
  assert.throws(() => createRouteIndex([families[0], { ...families[0] }]), /duplicate familyId/);
  assert.throws(() => assertLogicalTarget({ familyId: 'family-a', childId: 'alex', providerChannelId: 'discord-alex-a' }), /raw provider channel ids/);
  assert.deepEqual(assertLogicalTarget({ familyId: 'family-a', childId: 'alex' }), { familyId: 'family-a', childId: 'alex' });
});
