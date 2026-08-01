import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ClientUser } from './entities/client-user.entity';
import { ClientUsersRepository } from './client-users.repository';
import { ClientJwtStrategy } from './strategies/client-jwt.strategy';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    JwtModule.register({}),
    TypeOrmModule.forFeature([ClientUser]),
  ],
  providers: [ClientUsersRepository, ClientJwtStrategy],
  exports: [ClientUsersRepository, JwtModule, PassportModule],
})
export class PortalModule {}
