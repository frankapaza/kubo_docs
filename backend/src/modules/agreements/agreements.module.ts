import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Agreement } from './entities/agreement.entity';
import { Commitment } from './entities/commitment.entity';
import { AgreementsService } from './agreements.service';
import { AgreementsController } from './agreements.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Agreement, Commitment])],
  providers: [AgreementsService],
  controllers: [AgreementsController],
  exports: [AgreementsService],
})
export class AgreementsModule {}
