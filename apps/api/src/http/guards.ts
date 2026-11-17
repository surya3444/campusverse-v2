import { Id } from '@campusverse/contracts';
import type { Db } from '@campusverse/db';
import { authenticate, resolveActor } from '@campusverse/platform-identity';
import { authenticateStaff, customerAccess } from '@campusverse/platform-control';
import {
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { DB, type AuthedRequest } from './deps.js';

export const bearer = (req: AuthedRequest) => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
};

/** A live session, no profile chosen yet (for listing profiles, signing out). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Db) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = bearer(req);
    const session = token ? await authenticate(this.db, token) : null;
    if (!session) throw new UnauthorizedException({ code: 'unauthenticated' });
    req.session = session;
    return true;
  }
}

/**
 * A live session acting as one chosen person. The org and person come from headers, so they are
 * accepted only if this login is linked to that person. Never trust them otherwise.
 */
@Injectable()
export class ActorGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Db) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = bearer(req);
    const orgId = Id.safeParse(req.headers['x-org-id']);
    const personId = Id.safeParse(req.headers['x-person-id']);
    if (!token || !orgId.success || !personId.success)
      throw new UnauthorizedException({ code: 'unauthenticated' });
    const actor = await resolveActor(this.db, token, {
      orgId: orgId.data,
      personId: personId.data,
    });
    if (!actor) throw new UnauthorizedException({ code: 'unauthenticated' });
    // The super admin's decisions: a suspended or closed customer is refused, and the
    // writes_off switch makes every school read-only.
    const access = await customerAccess(this.db, actor.orgId);
    if (access.status !== 'active') throw new ForbiddenException({ code: 'customer_suspended' });
    if (access.writesOff && req.method !== 'GET' && req.method !== 'HEAD')
      throw new ServiceUnavailableException({ code: 'read_only' });
    req.actor = actor;
    return true;
  }
}

/** A Campusverse staff session (super admin). School sessions never pass, nor the reverse. */
@Injectable()
export class StaffGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Db) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = bearer(req);
    const staff = token ? await authenticateStaff(this.db, token) : null;
    if (!staff) throw new UnauthorizedException({ code: 'unauthenticated' });
    req.staff = staff;
    return true;
  }
}
