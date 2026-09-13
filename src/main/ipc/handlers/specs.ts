/** Специфікації, їхні версії та зведення (Stage 1 output). */

import type { IpcHandlers } from '@shared/ipc';
import type { IpcContext } from '../context';
import { requireId, requireSpecification, requireSpecVersion } from './guards';

export type SpecHandlers = Pick<
  IpcHandlers,
  'specs:list' | 'specs:get' | 'specs:setCloudAllowed' | 'specs:version' | 'specs:summary'
>;

export function specHandlers(ctx: IpcContext): SpecHandlers {
  const { db, events } = ctx;

  return {
    'specs:list': () => db.specs.list(),

    'specs:get': (specificationId) => db.specs.get(requireId(specificationId, 'specificationId')),

    /** ADR-8: перемикач «можна відправляти в хмару» живе на специфікації, не на прогоні. */
    'specs:setCloudAllowed': (specificationId, allowed) => {
      requireSpecification(db, specificationId);
      db.specs.setCloudAllowed(specificationId, Boolean(allowed));
      events.emit('library:changed', { kind: 'specifications' });
    },

    'specs:version': (specVersionId) => db.specs.getVersion(requireId(specVersionId, 'specVersionId')),

    'specs:summary': (specVersionId) => {
      requireSpecVersion(db, specVersionId);
      return db.specs.getSummary(specVersionId);
    },
  };
}
