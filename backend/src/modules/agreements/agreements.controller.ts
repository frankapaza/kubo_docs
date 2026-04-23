import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AgreementsService } from './agreements.service';
import { CreateAgreementDto, UpdateAgreementDto } from './dto/agreement.dto';
import { CreateCommitmentDto, UpdateCommitmentDto } from './dto/commitment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller()
@UseGuards(JwtAuthGuard)
export class AgreementsController {
  constructor(private readonly service: AgreementsService) {}

  // Agreements --------------------------------------------------------------
  @Get('actas/:actaId/agreements')
  listAgreements(@Param('actaId', ParseIntPipe) actaId: number) {
    return this.service.listAgreements(actaId);
  }

  @Post('actas/:actaId/agreements')
  createAgreement(
    @Param('actaId', ParseIntPipe) actaId: number,
    @Body() dto: CreateAgreementDto,
  ) {
    return this.service.createAgreement(actaId, dto);
  }

  @Patch('agreements/:id')
  updateAgreement(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAgreementDto) {
    return this.service.updateAgreement(id, dto);
  }

  @Delete('agreements/:id')
  removeAgreement(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeAgreement(id);
  }

  // Commitments -------------------------------------------------------------
  @Get('actas/:actaId/commitments')
  listCommitments(@Param('actaId', ParseIntPipe) actaId: number) {
    return this.service.listCommitments(actaId);
  }

  @Post('actas/:actaId/commitments')
  createCommitment(
    @Param('actaId', ParseIntPipe) actaId: number,
    @Body() dto: CreateCommitmentDto,
  ) {
    return this.service.createCommitment(actaId, dto);
  }

  @Patch('commitments/:id')
  updateCommitment(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCommitmentDto) {
    return this.service.updateCommitment(id, dto);
  }

  @Delete('commitments/:id')
  removeCommitment(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeCommitment(id);
  }
}
