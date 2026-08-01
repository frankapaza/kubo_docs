import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Guard del portal. Solo acepta tokens firmados con el secreto de cliente. */
@Injectable()
export class ClientJwtGuard extends AuthGuard('client-jwt') {}
