import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ClientUser } from './entities/client-user.entity';
import { ClientUsersRepository } from './client-users.repository';

@Module({
  imports: [TypeOrmModule.forFeature([ClientUser])],
  providers: [ClientUsersRepository],
  exports: [ClientUsersRepository],
})
export class PortalModule {}
